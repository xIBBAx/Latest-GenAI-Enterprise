import contextvars
import copy
import itertools
import re
from collections.abc import Callable
from collections.abc import Generator
from concurrent.futures import as_completed
from concurrent.futures import Future
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from datetime import timezone
from typing import Any
from typing import cast

from pydantic import BaseModel
from slack_sdk import WebClient
from slack_sdk.errors import SlackApiError
from slack_sdk.http_retry import ConnectionErrorRetryHandler
from slack_sdk.http_retry import RetryHandler
from typing_extensions import override

from onyx.configs.app_configs import ENABLE_EXPENSIVE_EXPERT_CALLS
from onyx.configs.app_configs import INDEX_BATCH_SIZE
from onyx.configs.app_configs import SLACK_NUM_THREADS
from onyx.configs.constants import DocumentSource
from onyx.connectors.exceptions import ConnectorValidationError
from onyx.connectors.exceptions import CredentialExpiredError
from onyx.connectors.exceptions import InsufficientPermissionsError
from onyx.connectors.exceptions import UnexpectedValidationError
from onyx.connectors.interfaces import CheckpointedConnector
from onyx.connectors.interfaces import CheckpointOutput
from onyx.connectors.interfaces import CredentialsConnector
from onyx.connectors.interfaces import CredentialsProviderInterface
from onyx.connectors.interfaces import GenerateSlimDocumentOutput
from onyx.connectors.interfaces import SecondsSinceUnixEpoch
from onyx.connectors.interfaces import SlimConnector
from onyx.connectors.models import BasicExpertInfo
from onyx.connectors.models import ConnectorCheckpoint
from onyx.connectors.models import ConnectorFailure
from onyx.connectors.models import ConnectorMissingCredentialError
from onyx.connectors.models import Document
from onyx.connectors.models import DocumentFailure
from onyx.connectors.models import EntityFailure
from onyx.connectors.models import SlimDocument
from onyx.connectors.models import TextSection
from onyx.connectors.slack.onyx_retry_handler import OnyxRedisSlackRetryHandler
from onyx.connectors.slack.utils import expert_info_from_slack_id
from onyx.connectors.slack.utils import get_message_link
from onyx.connectors.slack.utils import make_paginated_slack_api_call_w_retries
from onyx.connectors.slack.utils import make_slack_api_call_w_retries
from onyx.connectors.slack.utils import SlackTextCleaner
from onyx.indexing.indexing_heartbeat import IndexingHeartbeatInterface
from onyx.redis.redis_pool import get_redis_client
from onyx.utils.logger import setup_logger

logger = setup_logger()

_SLACK_LIMIT = 900


ChannelType = dict[str, Any]
MessageType = dict[str, Any]
# list of messages in a thread
ThreadType = list[MessageType]


class SlackCheckpoint(ConnectorCheckpoint):
    channel_ids: list[str] | None
    channel_completion_map: dict[str, str]
    current_channel: ChannelType | None
    seen_thread_ts: list[str]


def _collect_paginated_channels(
    client: WebClient,
    exclude_archived: bool,
    channel_types: list[str],
) -> list[ChannelType]:
    channels: list[dict[str, Any]] = []
    for result in make_paginated_slack_api_call_w_retries(
        client.conversations_list,
        exclude_archived=exclude_archived,
        # also get private channels the bot is added to
        types=channel_types,
    ):
        channels.extend(result["channels"])

    return channels


def get_channels(
    client: WebClient,
    exclude_archived: bool = True,
    get_public: bool = True,
    get_private: bool = True,
) -> list[ChannelType]:
    """Get all channels in the workspace."""
    channels: list[dict[str, Any]] = []
    channel_types = []
    if get_public:
        channel_types.append("public_channel")
    if get_private:
        channel_types.append("private_channel")
    # Try fetching both public and private channels first:
    try:
        channels = _collect_paginated_channels(
            client=client,
            exclude_archived=exclude_archived,
            channel_types=channel_types,
        )
    except SlackApiError as e:
        msg = f"Unable to fetch private channels due to: {e}."
        if not get_public:
            logger.warning(msg + " Public channels are not enabled.")
            return []

        logger.warning(msg + " Trying again with public channels only.")
        channel_types = ["public_channel"]
        channels = _collect_paginated_channels(
            client=client,
            exclude_archived=exclude_archived,
            channel_types=channel_types,
        )
    return channels


def get_channel_messages(
    client: WebClient,
    channel: dict[str, Any],
    oldest: str | None = None,
    latest: str | None = None,
    callback: IndexingHeartbeatInterface | None = None,
) -> Generator[list[MessageType], None, None]:
    """Get all messages in a channel"""
    # join so that the bot can access messages
    if not channel["is_member"]:
        make_slack_api_call_w_retries(
            client.conversations_join,
            channel=channel["id"],
            is_private=channel["is_private"],
        )
        logger.info(f"Successfully joined '{channel['name']}'")

    for result in make_paginated_slack_api_call_w_retries(
        client.conversations_history,
        channel=channel["id"],
        oldest=oldest,
        latest=latest,
    ):
        if callback:
            if callback.should_stop():
                raise RuntimeError("get_channel_messages: Stop signal detected")

            callback.progress("get_channel_messages", 0)
        yield cast(list[MessageType], result["messages"])


def get_thread(client: WebClient, channel_id: str, thread_id: str) -> ThreadType:
    """Get all messages in a thread"""
    threads: list[MessageType] = []
    for result in make_paginated_slack_api_call_w_retries(
        client.conversations_replies, channel=channel_id, ts=thread_id
    ):
        threads.extend(result["messages"])
    return threads


def get_latest_message_time(thread: ThreadType) -> datetime:
    max_ts = max([float(msg.get("ts", 0)) for msg in thread])
    return datetime.fromtimestamp(max_ts, tz=timezone.utc)


def _build_doc_id(channel_id: str, thread_ts: str) -> str:
    return f"{channel_id}__{thread_ts}"


def thread_to_doc(
    channel: ChannelType,
    thread: ThreadType,
    slack_cleaner: SlackTextCleaner,
    client: WebClient,
    user_cache: dict[str, BasicExpertInfo | None],
) -> Document:
    channel_id = channel["id"]

    initial_sender_expert_info = expert_info_from_slack_id(
        user_id=thread[0].get("user"), client=client, user_cache=user_cache
    )
    initial_sender_name = (
        initial_sender_expert_info.get_semantic_name()
        if initial_sender_expert_info
        else "Unknown"
    )

    valid_experts = None
    if ENABLE_EXPENSIVE_EXPERT_CALLS:
        all_sender_ids = [m.get("user") for m in thread]
        experts = [
            expert_info_from_slack_id(
                user_id=sender_id, client=client, user_cache=user_cache
            )
            for sender_id in all_sender_ids
            if sender_id
        ]
        valid_experts = [expert for expert in experts if expert]

    first_message = slack_cleaner.index_clean(cast(str, thread[0]["text"]))
    snippet = (
        first_message[:50].rstrip() + "..."
        if len(first_message) > 50
        else first_message
    )

    doc_sem_id = f"{initial_sender_name} in #{channel['name']}: {snippet}".replace(
        "\n", " "
    )

    return Document(
        id=_build_doc_id(channel_id=channel_id, thread_ts=thread[0]["ts"]),
        sections=[
            TextSection(
                link=get_message_link(event=m, client=client, channel_id=channel_id),
                text=slack_cleaner.index_clean(cast(str, m["text"])),
            )
            for m in thread
        ],
        source=DocumentSource.SLACK,
        semantic_identifier=doc_sem_id,
        doc_updated_at=get_latest_message_time(thread),
        primary_owners=valid_experts,
        metadata={"Channel": channel["name"]},
    )


# list of subtypes can be found here: https://api.slack.com/events/message
_DISALLOWED_MSG_SUBTYPES = {
    "channel_join",
    "channel_leave",
    "channel_archive",
    "channel_unarchive",
    "pinned_item",
    "unpinned_item",
    "ekm_access_denied",
    "channel_posting_permissions",
    "group_join",
    "group_leave",
    "group_archive",
    "group_unarchive",
    "channel_leave",
    "channel_name",
    "channel_join",
}


def default_msg_filter(message: MessageType) -> bool:
    # Don't keep messages from bots
    if message.get("bot_id") or message.get("app_id"):
        bot_profile_name = message.get("bot_profile", {}).get("name")
        if bot_profile_name == "DanswerBot Testing":
            return False
        return True

    # Uninformative
    if message.get("subtype", "") in _DISALLOWED_MSG_SUBTYPES:
        return True

    return False


def filter_channels(
    all_channels: list[dict[str, Any]],
    channels_to_connect: list[str] | None,
    regex_enabled: bool,
) -> list[dict[str, Any]]:
    if not channels_to_connect:
        return all_channels

    if regex_enabled:
        return [
            channel
            for channel in all_channels
            if any(
                re.fullmatch(channel_to_connect, channel["name"])
                for channel_to_connect in channels_to_connect
            )
        ]

    # validate that all channels in `channels_to_connect` are valid
    # fail loudly in the case of an invalid channel so that the user
    # knows that one of the channels they've specified is typo'd or private
    all_channel_names = {channel["name"] for channel in all_channels}
    for channel in channels_to_connect:
        if channel not in all_channel_names:
            raise ValueError(
                f"Channel '{channel}' not found in workspace. "
                f"Available channels (Showing {len(all_channel_names)} of "
                f"{min(len(all_channel_names), SlackConnector.MAX_CHANNELS_TO_LOG)}): "
                f"{list(itertools.islice(all_channel_names, SlackConnector.MAX_CHANNELS_TO_LOG))}"
            )

    return [
        channel for channel in all_channels if channel["name"] in channels_to_connect
    ]


def _get_channel_by_id(client: WebClient, channel_id: str) -> ChannelType:
    """Get a channel by its ID.

    Args:
        client: The Slack WebClient instance
        channel_id: The ID of the channel to fetch

    Returns:
        The channel information

    Raises:
        SlackApiError: If the channel cannot be fetched
    """
    response = make_slack_api_call_w_retries(
        client.conversations_info,
        channel=channel_id,
    )
    return cast(ChannelType, response["channel"])


def _get_messages(
    channel: ChannelType,
    client: WebClient,
    oldest: str | None = None,
    latest: str | None = None,
) -> tuple[list[MessageType], bool]:
    """Slack goes from newest to oldest."""

    # have to be in the channel in order to read messages
    if not channel["is_member"]:
        try:
            make_slack_api_call_w_retries(
                client.conversations_join,
                channel=channel["id"],
                is_private=channel["is_private"],
            )
        except SlackApiError as e:
            if e.response["error"] == "is_archived":
                logger.warning(f"Channel {channel['name']} is archived. Skipping.")
                return [], False

            logger.exception(f"Error joining channel {channel['name']}")
            raise
        logger.info(f"Successfully joined '{channel['name']}'")

    response = make_slack_api_call_w_retries(
        client.conversations_history,
        channel=channel["id"],
        oldest=oldest,
        latest=latest,
        limit=_SLACK_LIMIT,
    )
    response.validate()

    messages = cast(list[MessageType], response.get("messages", []))

    cursor = cast(dict[str, Any], response.get("response_metadata", {})).get(
        "next_cursor", ""
    )
    has_more = bool(cursor)
    return messages, has_more


def _message_to_doc(
    message: MessageType,
    client: WebClient,
    channel: ChannelType,
    slack_cleaner: SlackTextCleaner,
    user_cache: dict[str, BasicExpertInfo | None],
    seen_thread_ts: set[str],
    msg_filter_func: Callable[[MessageType], bool] = default_msg_filter,
) -> Document | None:
    filtered_thread: ThreadType | None = None
    thread_ts = message.get("thread_ts")
    if thread_ts:
        # skip threads we've already seen, since we've already processed all
        # messages in that thread
        if thread_ts in seen_thread_ts:
            return None

        thread = get_thread(
            client=client, channel_id=channel["id"], thread_id=thread_ts
        )
        filtered_thread = [
            message for message in thread if not msg_filter_func(message)
        ]
    elif not msg_filter_func(message):
        filtered_thread = [message]

    if filtered_thread:
        return thread_to_doc(
            channel=channel,
            thread=filtered_thread,
            slack_cleaner=slack_cleaner,
            client=client,
            user_cache=user_cache,
        )

    return None


def _get_all_doc_ids(
    client: WebClient,
    channels: list[str] | None = None,
    channel_name_regex_enabled: bool = False,
    msg_filter_func: Callable[[MessageType], bool] = default_msg_filter,
    callback: IndexingHeartbeatInterface | None = None,
) -> GenerateSlimDocumentOutput:
    """
    Get all document ids in the workspace, channel by channel
    This is pretty identical to get_all_docs, but it returns a set of ids instead of documents
    This makes it an order of magnitude faster than get_all_docs
    """

    all_channels = get_channels(client)
    filtered_channels = filter_channels(
        all_channels, channels, channel_name_regex_enabled
    )

    for channel in filtered_channels:
        channel_id = channel["id"]
        channel_message_batches = get_channel_messages(
            client=client,
            channel=channel,
            callback=callback,
        )

        for message_batch in channel_message_batches:
            slim_doc_batch: list[SlimDocument] = []
            for message in message_batch:
                if msg_filter_func(message):
                    continue

                # The document id is the channel id and the ts of the first message in the thread
                # Since we already have the first message of the thread, we dont have to
                # fetch the thread for id retrieval, saving time and API calls

                slim_doc_batch.append(
                    SlimDocument(
                        id=_build_doc_id(
                            channel_id=channel_id, thread_ts=message["ts"]
                        ),
                        perm_sync_data={"channel_id": channel_id},
                    )
                )

            yield slim_doc_batch


class ProcessedSlackMessage(BaseModel):
    doc: Document | None
    # if the message is part of a thread, this is the thread_ts
    # otherwise, this is the message_ts. Either way, will be a unique identifier.
    # In the future, if the message becomes a thread, then the thread_ts
    # will be set to the message_ts.
    thread_or_message_ts: str
    failure: ConnectorFailure | None


def _process_message(
    message: MessageType,
    client: WebClient,
    channel: ChannelType,
    slack_cleaner: SlackTextCleaner,
    user_cache: dict[str, BasicExpertInfo | None],
    seen_thread_ts: set[str],
    msg_filter_func: Callable[[MessageType], bool] = default_msg_filter,
) -> ProcessedSlackMessage:
    thread_ts = message.get("thread_ts")
    thread_or_message_ts = thread_ts or message["ts"]
    try:
        # causes random failures for testing checkpointing / continue on failure
        # import random
        # if random.random() > 0.95:
        #     raise RuntimeError("Random failure :P")

        doc = _message_to_doc(
            message=message,
            client=client,
            channel=channel,
            slack_cleaner=slack_cleaner,
            user_cache=user_cache,
            seen_thread_ts=seen_thread_ts,
            msg_filter_func=msg_filter_func,
        )
        return ProcessedSlackMessage(
            doc=doc, thread_or_message_ts=thread_or_message_ts, failure=None
        )
    except Exception as e:
        logger.exception(f"Error processing message {message['ts']}")
        return ProcessedSlackMessage(
            doc=None,
            thread_or_message_ts=thread_or_message_ts,
            failure=ConnectorFailure(
                failed_document=DocumentFailure(
                    document_id=_build_doc_id(
                        channel_id=channel["id"], thread_ts=thread_or_message_ts
                    ),
                    document_link=get_message_link(message, client, channel["id"]),
                ),
                failure_message=str(e),
                exception=e,
            ),
        )


class SlackConnector(
    SlimConnector, CredentialsConnector, CheckpointedConnector[SlackCheckpoint]
):
    FAST_TIMEOUT = 1

    MAX_RETRIES = 7  # arbitrarily selected

    MAX_CHANNELS_TO_LOG = 50

    def __init__(
        self,
        channels: list[str] | None = None,
        # if specified, will treat the specified channel strings as
        # regexes, and will only index channels that fully match the regexes
        channel_regex_enabled: bool = False,
        batch_size: int = INDEX_BATCH_SIZE,
        num_threads: int = SLACK_NUM_THREADS,
    ) -> None:
        self.channels = channels
        self.channel_regex_enabled = channel_regex_enabled
        self.batch_size = batch_size
        self.num_threads = num_threads
        self.client: WebClient | None = None
        self.fast_client: WebClient | None = None
        # just used for efficiency
        self.text_cleaner: SlackTextCleaner | None = None
        self.user_cache: dict[str, BasicExpertInfo | None] = {}
        self.credentials_provider: CredentialsProviderInterface | None = None
        self.credential_prefix: str | None = None
        self.delay_lock: str | None = None  # the redis key for the shared lock
        self.delay_key: str | None = None  # the redis key for the shared delay

    @property
    def channels(self) -> list[str] | None:
        return self._channels

    @channels.setter
    def channels(self, channels: list[str] | None) -> None:
        self._channels = (
            [channel.removeprefix("#") for channel in channels] if channels else None
        )

    def load_credentials(self, credentials: dict[str, Any]) -> dict[str, Any] | None:
        raise NotImplementedError("Use set_credentials_provider with this connector.")

    def set_credentials_provider(
        self, credentials_provider: CredentialsProviderInterface
    ) -> None:
        credentials = credentials_provider.get_credentials()
        tenant_id = credentials_provider.get_tenant_id()
        self.redis = get_redis_client(tenant_id=tenant_id)

        self.credential_prefix = (
            f"connector:slack:credential_{credentials_provider.get_provider_key()}"
        )
        self.delay_lock = f"{self.credential_prefix}:delay_lock"
        self.delay_key = f"{self.credential_prefix}:delay"

        # NOTE: slack has a built in RateLimitErrorRetryHandler, but it isn't designed
        # for concurrent workers. We've extended it with OnyxRedisSlackRetryHandler.
        connection_error_retry_handler = ConnectionErrorRetryHandler()
        onyx_rate_limit_error_retry_handler = OnyxRedisSlackRetryHandler(
            max_retry_count=self.MAX_RETRIES,
            delay_lock=self.delay_lock,
            delay_key=self.delay_key,
            r=self.redis,
        )
        custom_retry_handlers: list[RetryHandler] = [
            connection_error_retry_handler,
            onyx_rate_limit_error_retry_handler,
        ]

        bot_token = credentials["slack_bot_token"]
        self.client = WebClient(token=bot_token, retry_handlers=custom_retry_handlers)
        # use for requests that must return quickly (e.g. realtime flows where user is waiting)
        self.fast_client = WebClient(
            token=bot_token, timeout=SlackConnector.FAST_TIMEOUT
        )
        self.text_cleaner = SlackTextCleaner(client=self.client)
        self.credentials_provider = credentials_provider

    def retrieve_all_slim_documents(
        self,
        start: SecondsSinceUnixEpoch | None = None,
        end: SecondsSinceUnixEpoch | None = None,
        callback: IndexingHeartbeatInterface | None = None,
    ) -> GenerateSlimDocumentOutput:
        if self.client is None:
            raise ConnectorMissingCredentialError("Slack")

        return _get_all_doc_ids(
            client=self.client,
            channels=self.channels,
            channel_name_regex_enabled=self.channel_regex_enabled,
            callback=callback,
        )

    def load_from_checkpoint(
        self,
        start: SecondsSinceUnixEpoch,
        end: SecondsSinceUnixEpoch,
        checkpoint: SlackCheckpoint,
    ) -> CheckpointOutput[SlackCheckpoint]:
        """Rough outline:

        Step 1: Get all channels, yield back Checkpoint.
        Step 2: Loop through each channel. For each channel:
            Step 2.1: Get messages within the time range.
            Step 2.2: Process messages in parallel, yield back docs.
            Step 2.3: Update checkpoint with new_latest, seen_thread_ts, and current_channel.
                      Slack returns messages from newest to oldest, so we need to keep track of
                      the latest message we've seen in each channel.
            Step 2.4: If there are no more messages in the channel, switch the current
                      channel to the next channel.
        """
        if self.client is None or self.text_cleaner is None:
            raise ConnectorMissingCredentialError("Slack")

        checkpoint = cast(SlackCheckpoint, copy.deepcopy(checkpoint))

        # if this is the very first time we've called this, need to
        # get all relevant channels and save them into the checkpoint
        if checkpoint.channel_ids is None:
            raw_channels = get_channels(self.client)
            filtered_channels = filter_channels(
                raw_channels, self.channels, self.channel_regex_enabled
            )
            logger.info(
                f"Channels: all={len(raw_channels)} post_filtering={len(filtered_channels)}"
            )

            checkpoint.channel_ids = [c["id"] for c in filtered_channels]
            if len(filtered_channels) == 0:
                checkpoint.has_more = False
                return checkpoint

            checkpoint.current_channel = filtered_channels[0]
            checkpoint.has_more = True
            return checkpoint

        final_channel_ids = checkpoint.channel_ids
        channel = checkpoint.current_channel
        if channel is None:
            raise ValueError("current_channel key not set in checkpoint")

        channel_id = channel["id"]
        if channel_id not in final_channel_ids:
            raise ValueError(f"Channel {channel_id} not found in checkpoint")

        oldest = str(start) if start else None
        latest = checkpoint.channel_completion_map.get(channel_id, str(end))
        seen_thread_ts = set(checkpoint.seen_thread_ts)
        try:
            logger.debug(
                f"Getting messages for channel {channel} within range {oldest} - {latest}"
            )
            message_batch, has_more_in_channel = _get_messages(
                channel, self.client, oldest, latest
            )
            new_latest = message_batch[-1]["ts"] if message_batch else latest

            num_threads_start = len(seen_thread_ts)
            # Process messages in parallel using ThreadPoolExecutor
            with ThreadPoolExecutor(max_workers=self.num_threads) as executor:
                futures: list[Future[ProcessedSlackMessage]] = []
                for message in message_batch:
                    # Capture the current context so that the thread gets the current tenant ID
                    current_context = contextvars.copy_context()
                    futures.append(
                        executor.submit(
                            current_context.run,
                            _process_message,
                            message=message,
                            client=self.client,
                            channel=channel,
                            slack_cleaner=self.text_cleaner,
                            user_cache=self.user_cache,
                            seen_thread_ts=seen_thread_ts,
                        )
                    )

                for future in as_completed(futures):
                    processed_slack_message = future.result()
                    doc = processed_slack_message.doc
                    thread_or_message_ts = processed_slack_message.thread_or_message_ts
                    failure = processed_slack_message.failure
                    if doc:
                        # handle race conditions here since this is single
                        # threaded. Multi-threaded _process_message reads from this
                        # but since this is single threaded, we won't run into simul
                        # writes. At worst, we can duplicate a thread, which will be
                        # deduped later on.
                        if thread_or_message_ts not in seen_thread_ts:
                            yield doc

                        seen_thread_ts.add(thread_or_message_ts)
                    elif failure:
                        yield failure

            num_threads_processed = len(seen_thread_ts) - num_threads_start
            logger.info(f"Processed {num_threads_processed} threads.")

            checkpoint.seen_thread_ts = list(seen_thread_ts)
            checkpoint.channel_completion_map[channel["id"]] = new_latest
            if has_more_in_channel:
                checkpoint.current_channel = channel
            else:
                new_channel_id = next(
                    (
                        channel_id
                        for channel_id in final_channel_ids
                        if channel_id not in checkpoint.channel_completion_map
                    ),
                    None,
                )
                if new_channel_id:
                    new_channel = _get_channel_by_id(self.client, new_channel_id)
                    checkpoint.current_channel = new_channel
                else:
                    checkpoint.current_channel = None

            checkpoint.has_more = checkpoint.current_channel is not None
            return checkpoint

        except Exception as e:
            logger.exception(f"Error processing channel {channel['name']}")
            yield ConnectorFailure(
                failed_entity=EntityFailure(
                    entity_id=channel["id"],
                    missed_time_range=(
                        datetime.fromtimestamp(start, tz=timezone.utc),
                        datetime.fromtimestamp(end, tz=timezone.utc),
                    ),
                ),
                failure_message=str(e),
                exception=e,
            )
            return checkpoint

    def validate_connector_settings(self) -> None:
        """
        1. Verify the bot token is valid for the workspace (via auth_test).
        2. Ensure the bot has enough scope to list channels.
        3. Check that every channel specified in self.channels exists (only when regex is not enabled).
        """
        if self.fast_client is None:
            raise ConnectorMissingCredentialError("Slack credentials not loaded.")

        try:
            # 1) Validate connection to workspace
            auth_response = self.fast_client.auth_test()
            if not auth_response.get("ok", False):
                error_msg = auth_response.get(
                    "error", "Unknown error from Slack auth_test"
                )
                raise ConnectorValidationError(f"Failed Slack auth_test: {error_msg}")

            # 2) Minimal test to confirm listing channels works
            test_resp = self.fast_client.conversations_list(
                limit=1, types=["public_channel"]
            )
            if not test_resp.get("ok", False):
                error_msg = test_resp.get("error", "Unknown error from Slack")
                if error_msg == "invalid_auth":
                    raise ConnectorValidationError(
                        f"Invalid Slack bot token ({error_msg})."
                    )
                elif error_msg == "not_authed":
                    raise CredentialExpiredError(
                        f"Invalid or expired Slack bot token ({error_msg})."
                    )
                raise UnexpectedValidationError(
                    f"Slack API returned a failure: {error_msg}"
                )

            # 3) If channels are specified and regex is not enabled, verify each is accessible
            # NOTE: removed this for now since it may be too slow for large workspaces which may
            # have some automations which create a lot of channels (100k+)

            # if self.channels and not self.channel_regex_enabled:
            #     accessible_channels = get_channels(
            #         client=self.fast_client,
            #         exclude_archived=True,
            #         get_public=True,
            #         get_private=True,
            #     )
            #     # For quick lookups by name or ID, build a map:
            #     accessible_channel_names = {ch["name"] for ch in accessible_channels}
            #     accessible_channel_ids = {ch["id"] for ch in accessible_channels}

            #     for user_channel in self.channels:
            #         if (
            #             user_channel not in accessible_channel_names
            #             and user_channel not in accessible_channel_ids
            #         ):
            #             raise ConnectorValidationError(
            #                 f"Channel '{user_channel}' not found or inaccessible in this workspace."
            #             )

        except SlackApiError as e:
            slack_error = e.response.get("error", "")
            if slack_error == "ratelimited":
                # Handle rate limiting specifically
                retry_after = int(e.response.headers.get("Retry-After", 1))
                logger.warning(
                    f"Slack API rate limited during validation. Retry suggested after {retry_after} seconds. "
                    "Proceeding with validation, but be aware that connector operations might be throttled."
                )
                # Continue validation without failing - the connector is likely valid but just rate limited
                return
            elif slack_error == "missing_scope":
                raise InsufficientPermissionsError(
                    "Slack bot token lacks the necessary scope to list/access channels. "
                    "Please ensure your Slack app has 'channels:read' (and/or 'groups:read' for private channels)."
                )
            elif slack_error == "invalid_auth":
                raise CredentialExpiredError(
                    f"Invalid Slack bot token ({slack_error})."
                )
            elif slack_error == "not_authed":
                raise CredentialExpiredError(
                    f"Invalid or expired Slack bot token ({slack_error})."
                )
            raise UnexpectedValidationError(
                f"Unexpected Slack error '{slack_error}' during settings validation."
            )
        except ConnectorValidationError as e:
            raise e
        except Exception as e:
            raise UnexpectedValidationError(
                f"Unexpected error during Slack settings validation: {e}"
            )

    @override
    def build_dummy_checkpoint(self) -> SlackCheckpoint:
        return SlackCheckpoint(
            channel_ids=None,
            channel_completion_map={},
            current_channel=None,
            seen_thread_ts=[],
            has_more=True,
        )

    @override
    def validate_checkpoint_json(self, checkpoint_json: str) -> SlackCheckpoint:
        return SlackCheckpoint.model_validate_json(checkpoint_json)


if __name__ == "__main__":
    import os
    import time
    from onyx.connectors.credentials_provider import OnyxStaticCredentialsProvider
    from shared_configs.contextvars import get_current_tenant_id

    slack_channel = os.environ.get("SLACK_CHANNEL")
    connector = SlackConnector(
        channels=[slack_channel] if slack_channel else None,
    )

    provider = OnyxStaticCredentialsProvider(
        tenant_id=get_current_tenant_id(),
        connector_name="slack",
        credential_json={
            "slack_bot_token": os.environ["SLACK_BOT_TOKEN"],
        },
    )
    connector.set_credentials_provider(provider)

    current = time.time()
    one_day_ago = current - 24 * 60 * 60  # 1 day

    checkpoint = connector.build_dummy_checkpoint()

    gen = connector.load_from_checkpoint(
        one_day_ago, current, cast(SlackCheckpoint, checkpoint)
    )
    try:
        for document_or_failure in gen:
            if isinstance(document_or_failure, Document):
                print(document_or_failure)
            elif isinstance(document_or_failure, ConnectorFailure):
                print(document_or_failure)
    except StopIteration as e:
        checkpoint = e.value
        print("Next checkpoint:", checkpoint)

    print("Next checkpoint:", checkpoint)
