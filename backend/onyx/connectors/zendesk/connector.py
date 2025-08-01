import copy
import time
from collections.abc import Iterator
from typing import Any
from typing import cast

import requests
from pydantic import BaseModel
from requests.exceptions import HTTPError
from typing_extensions import override

from onyx.configs.app_configs import ZENDESK_CONNECTOR_SKIP_ARTICLE_LABELS
from onyx.configs.constants import DocumentSource
from onyx.connectors.cross_connector_utils.miscellaneous_utils import (
    time_str_to_utc,
)
from onyx.connectors.exceptions import ConnectorValidationError
from onyx.connectors.exceptions import CredentialExpiredError
from onyx.connectors.exceptions import InsufficientPermissionsError
from onyx.connectors.interfaces import CheckpointedConnector
from onyx.connectors.interfaces import CheckpointOutput
from onyx.connectors.interfaces import ConnectorFailure
from onyx.connectors.interfaces import GenerateSlimDocumentOutput
from onyx.connectors.interfaces import SecondsSinceUnixEpoch
from onyx.connectors.interfaces import SlimConnector
from onyx.connectors.models import BasicExpertInfo
from onyx.connectors.models import ConnectorCheckpoint
from onyx.connectors.models import Document
from onyx.connectors.models import DocumentFailure
from onyx.connectors.models import SlimDocument
from onyx.connectors.models import TextSection
from onyx.file_processing.html_utils import parse_html_page_basic
from onyx.indexing.indexing_heartbeat import IndexingHeartbeatInterface
from onyx.utils.retry_wrapper import retry_builder


MAX_PAGE_SIZE = 30  # Zendesk API maximum
MAX_AUTHOR_MAP_SIZE = 50_000  # Reset author map cache if it gets too large
_SLIM_BATCH_SIZE = 1000


class ZendeskCredentialsNotSetUpError(PermissionError):
    def __init__(self) -> None:
        super().__init__(
            "Zendesk Credentials are not set up, was load_credentials called?"
        )


class ZendeskClient:
    def __init__(self, subdomain: str, email: str, token: str):
        self.base_url = f"https://{subdomain}.zendesk.com/api/v2"
        self.auth = (f"{email}/token", token)

    @retry_builder()
    def make_request(self, endpoint: str, params: dict[str, Any]) -> dict[str, Any]:
        response = requests.get(
            f"{self.base_url}/{endpoint}", auth=self.auth, params=params
        )

        if response.status_code == 429:
            retry_after = response.headers.get("Retry-After")
            if retry_after is not None:
                # Sleep for the duration indicated by the Retry-After header
                time.sleep(int(retry_after))

        elif (
            response.status_code == 403
            and response.json().get("error") == "SupportProductInactive"
        ):
            return response.json()

        response.raise_for_status()
        return response.json()


class ZendeskPageResponse(BaseModel):
    data: list[dict[str, Any]]
    meta: dict[str, Any]
    has_more: bool


def _get_content_tag_mapping(client: ZendeskClient) -> dict[str, str]:
    content_tags: dict[str, str] = {}
    params = {"page[size]": MAX_PAGE_SIZE}

    try:
        while True:
            data = client.make_request("guide/content_tags", params)

            for tag in data.get("records", []):
                content_tags[tag["id"]] = tag["name"]

            # Check if there are more pages
            if data.get("meta", {}).get("has_more", False):
                params["page[after]"] = data["meta"]["after_cursor"]
            else:
                break

        return content_tags
    except Exception as e:
        raise Exception(f"Error fetching content tags: {str(e)}")


def _get_articles(
    client: ZendeskClient, start_time: int | None = None, page_size: int = MAX_PAGE_SIZE
) -> Iterator[dict[str, Any]]:
    params = {"page[size]": page_size, "sort_by": "updated_at", "sort_order": "asc"}
    if start_time is not None:
        params["start_time"] = start_time

    while True:
        data = client.make_request("help_center/articles", params)
        for article in data["articles"]:
            yield article

        if not data.get("meta", {}).get("has_more"):
            break
        params["page[after]"] = data["meta"]["after_cursor"]


def _get_article_page(
    client: ZendeskClient,
    start_time: int | None = None,
    after_cursor: str | None = None,
    page_size: int = MAX_PAGE_SIZE,
) -> ZendeskPageResponse:
    params = {"page[size]": page_size, "sort_by": "updated_at", "sort_order": "asc"}
    if start_time is not None:
        params["start_time"] = start_time
    if after_cursor is not None:
        params["page[after]"] = after_cursor

    data = client.make_request("help_center/articles", params)
    return ZendeskPageResponse(
        data=data["articles"],
        meta=data["meta"],
        has_more=bool(data["meta"].get("has_more", False)),
    )


def _get_tickets(
    client: ZendeskClient, start_time: int | None = None
) -> Iterator[dict[str, Any]]:
    params = {"start_time": start_time or 0}

    while True:
        data = client.make_request("incremental/tickets.json", params)
        for ticket in data["tickets"]:
            yield ticket

        if not data.get("end_of_stream", False):
            params["start_time"] = data["end_time"]
        else:
            break


# TODO: maybe these don't need to be their own functions?
def _get_tickets_page(
    client: ZendeskClient, start_time: int | None = None
) -> ZendeskPageResponse:
    params = {"start_time": start_time or 0}

    # NOTE: for some reason zendesk doesn't seem to be respecting the start_time param
    # in my local testing with very few tickets. We'll look into it if this becomes an
    # issue in larger deployments
    data = client.make_request("incremental/tickets.json", params)
    if data.get("error") == "SupportProductInactive":
        raise ValueError(
            "Zendesk Support Product is not active for this account, No tickets to index"
        )
    return ZendeskPageResponse(
        data=data["tickets"],
        meta={"end_time": data["end_time"]},
        has_more=not bool(data.get("end_of_stream", False)),
    )


def _fetch_author(
    client: ZendeskClient, author_id: str | int
) -> BasicExpertInfo | None:
    # Skip fetching if author_id is invalid
    # cast to str to avoid issues with zendesk changing their types
    if not author_id or str(author_id) == "-1":
        return None

    try:
        author_data = client.make_request(f"users/{author_id}", {})
        user = author_data.get("user")
        return (
            BasicExpertInfo(display_name=user.get("name"), email=user.get("email"))
            if user and user.get("name") and user.get("email")
            else None
        )
    except requests.exceptions.HTTPError:
        # Handle any API errors gracefully
        return None


def _article_to_document(
    article: dict[str, Any],
    content_tags: dict[str, str],
    author_map: dict[str, BasicExpertInfo],
    client: ZendeskClient,
) -> tuple[dict[str, BasicExpertInfo] | None, Document]:
    author_id = article.get("author_id")
    if not author_id:
        author = None
    else:
        author = (
            author_map.get(author_id)
            if author_id in author_map
            else _fetch_author(client, author_id)
        )

    new_author_mapping = {author_id: author} if author_id and author else None

    updated_at = article.get("updated_at")
    update_time = time_str_to_utc(updated_at) if updated_at else None

    # Build metadata
    metadata: dict[str, str | list[str]] = {
        "labels": [str(label) for label in article.get("label_names", []) if label],
        "content_tags": [
            content_tags[tag_id]
            for tag_id in article.get("content_tag_ids", [])
            if tag_id in content_tags
        ],
    }

    # Remove empty values
    metadata = {k: v for k, v in metadata.items() if v}

    return new_author_mapping, Document(
        id=f"article:{article['id']}",
        sections=[
            TextSection(
                link=cast(str, article.get("html_url")),
                text=parse_html_page_basic(article["body"]),
            )
        ],
        source=DocumentSource.ZENDESK,
        semantic_identifier=article["title"],
        doc_updated_at=update_time,
        primary_owners=[author] if author else None,
        metadata=metadata,
    )


def _get_comment_text(
    comment: dict[str, Any],
    author_map: dict[str, BasicExpertInfo],
    client: ZendeskClient,
) -> tuple[dict[str, BasicExpertInfo] | None, str]:
    author_id = comment.get("author_id")
    if not author_id:
        author = None
    else:
        author = (
            author_map.get(author_id)
            if author_id in author_map
            else _fetch_author(client, author_id)
        )

    new_author_mapping = {author_id: author} if author_id and author else None

    comment_text = f"Comment{' by ' + author.display_name if author and author.display_name else ''}"
    comment_text += f"{' at ' + comment['created_at'] if comment.get('created_at') else ''}:\n{comment['body']}"

    return new_author_mapping, comment_text


def _ticket_to_document(
    ticket: dict[str, Any],
    author_map: dict[str, BasicExpertInfo],
    client: ZendeskClient,
    default_subdomain: str,
) -> tuple[dict[str, BasicExpertInfo] | None, Document]:
    submitter_id = ticket.get("submitter")
    if not submitter_id:
        submitter = None
    else:
        submitter = (
            author_map.get(submitter_id)
            if submitter_id in author_map
            else _fetch_author(client, submitter_id)
        )

    new_author_mapping = (
        {submitter_id: submitter} if submitter_id and submitter else None
    )

    updated_at = ticket.get("updated_at")
    update_time = time_str_to_utc(updated_at) if updated_at else None

    metadata: dict[str, str | list[str]] = {}
    if status := ticket.get("status"):
        metadata["status"] = status
    if priority := ticket.get("priority"):
        metadata["priority"] = priority
    if tags := ticket.get("tags"):
        metadata["tags"] = tags
    if ticket_type := ticket.get("type"):
        metadata["ticket_type"] = ticket_type

    # Fetch comments for the ticket
    comments_data = client.make_request(f"tickets/{ticket.get('id')}/comments", {})
    comments = comments_data.get("comments", [])

    comment_texts = []
    for comment in comments:
        new_author_mapping, comment_text = _get_comment_text(
            comment, author_map, client
        )
        if new_author_mapping:
            author_map.update(new_author_mapping)
        comment_texts.append(comment_text)

    comments_text = "\n\n".join(comment_texts)

    subject = ticket.get("subject")
    full_text = f"Ticket Subject:\n{subject}\n\nComments:\n{comments_text}"

    ticket_url = ticket.get("url")
    subdomain = (
        ticket_url.split("//")[1].split(".zendesk.com")[0]
        if ticket_url
        else default_subdomain
    )

    ticket_display_url = (
        f"https://{subdomain}.zendesk.com/agent/tickets/{ticket.get('id')}"
    )

    return new_author_mapping, Document(
        id=f"zendesk_ticket_{ticket['id']}",
        sections=[TextSection(link=ticket_display_url, text=full_text)],
        source=DocumentSource.ZENDESK,
        semantic_identifier=f"Ticket #{ticket['id']}: {subject or 'No Subject'}",
        doc_updated_at=update_time,
        primary_owners=[submitter] if submitter else None,
        metadata=metadata,
    )


class ZendeskConnectorCheckpoint(ConnectorCheckpoint):
    # We use cursor-based paginated retrieval for articles
    after_cursor_articles: str | None

    # We use timestamp-based paginated retrieval for tickets
    next_start_time_tickets: int | None

    cached_author_map: dict[str, BasicExpertInfo] | None
    cached_content_tags: dict[str, str] | None


class ZendeskConnector(
    SlimConnector, CheckpointedConnector[ZendeskConnectorCheckpoint]
):
    def __init__(
        self,
        content_type: str = "articles",
    ) -> None:
        self.content_type = content_type
        self.subdomain = ""
        # Fetch all tags ahead of time
        self.content_tags: dict[str, str] = {}

    def load_credentials(self, credentials: dict[str, Any]) -> dict[str, Any] | None:
        # Subdomain is actually the whole URL
        subdomain = (
            credentials["zendesk_subdomain"]
            .replace("https://", "")
            .split(".zendesk.com")[0]
        )
        self.subdomain = subdomain

        self.client = ZendeskClient(
            subdomain, credentials["zendesk_email"], credentials["zendesk_token"]
        )
        return None

    @override
    def load_from_checkpoint(
        self,
        start: SecondsSinceUnixEpoch,
        end: SecondsSinceUnixEpoch,
        checkpoint: ZendeskConnectorCheckpoint,
    ) -> CheckpointOutput[ZendeskConnectorCheckpoint]:
        if self.client is None:
            raise ZendeskCredentialsNotSetUpError()

        if checkpoint.cached_content_tags is None:
            checkpoint.cached_content_tags = _get_content_tag_mapping(self.client)
            return checkpoint  # save the content tags to the checkpoint
        self.content_tags = checkpoint.cached_content_tags

        if self.content_type == "articles":
            checkpoint = yield from self._retrieve_articles(start, end, checkpoint)
            return checkpoint
        elif self.content_type == "tickets":
            checkpoint = yield from self._retrieve_tickets(start, end, checkpoint)
            return checkpoint
        else:
            raise ValueError(f"Unsupported content_type: {self.content_type}")

    def _retrieve_articles(
        self,
        start: SecondsSinceUnixEpoch | None,
        end: SecondsSinceUnixEpoch | None,
        checkpoint: ZendeskConnectorCheckpoint,
    ) -> CheckpointOutput[ZendeskConnectorCheckpoint]:
        checkpoint = copy.deepcopy(checkpoint)
        # This one is built on the fly as there may be more many more authors than tags
        author_map: dict[str, BasicExpertInfo] = checkpoint.cached_author_map or {}
        after_cursor = checkpoint.after_cursor_articles
        doc_batch: list[Document] = []

        response = _get_article_page(
            self.client,
            start_time=int(start) if start else None,
            after_cursor=after_cursor,
        )
        articles = response.data
        has_more = response.has_more
        after_cursor = response.meta.get("after_cursor")
        for article in articles:
            if (
                article.get("body") is None
                or article.get("draft")
                or any(
                    label in ZENDESK_CONNECTOR_SKIP_ARTICLE_LABELS
                    for label in article.get("label_names", [])
                )
            ):
                continue

            try:
                new_author_map, document = _article_to_document(
                    article, self.content_tags, author_map, self.client
                )
            except Exception as e:
                yield ConnectorFailure(
                    failed_document=DocumentFailure(
                        document_id=f"{article.get('id')}",
                        document_link=article.get("html_url", ""),
                    ),
                    failure_message=str(e),
                    exception=e,
                )
                continue

            if new_author_map:
                author_map.update(new_author_map)

            doc_batch.append(document)

        if not has_more:
            yield from doc_batch
            checkpoint.has_more = False
            return checkpoint

        # Sometimes no documents are retrieved, but the cursor
        # is still updated so the connector makes progress.
        yield from doc_batch
        checkpoint.after_cursor_articles = after_cursor

        last_doc_updated_at = doc_batch[-1].doc_updated_at if doc_batch else None
        checkpoint.has_more = bool(
            end is None
            or last_doc_updated_at is None
            or last_doc_updated_at.timestamp() <= end
        )
        checkpoint.cached_author_map = (
            author_map if len(author_map) <= MAX_AUTHOR_MAP_SIZE else None
        )
        return checkpoint

    def _retrieve_tickets(
        self,
        start: SecondsSinceUnixEpoch | None,
        end: SecondsSinceUnixEpoch | None,
        checkpoint: ZendeskConnectorCheckpoint,
    ) -> CheckpointOutput[ZendeskConnectorCheckpoint]:
        checkpoint = copy.deepcopy(checkpoint)
        if self.client is None:
            raise ZendeskCredentialsNotSetUpError()

        author_map: dict[str, BasicExpertInfo] = checkpoint.cached_author_map or {}

        doc_batch: list[Document] = []
        next_start_time = int(checkpoint.next_start_time_tickets or start or 0)
        ticket_response = _get_tickets_page(self.client, start_time=next_start_time)
        tickets = ticket_response.data
        has_more = ticket_response.has_more
        next_start_time = ticket_response.meta["end_time"]
        for ticket in tickets:
            if ticket.get("status") == "deleted":
                continue

            try:
                new_author_map, document = _ticket_to_document(
                    ticket=ticket,
                    author_map=author_map,
                    client=self.client,
                    default_subdomain=self.subdomain,
                )
            except Exception as e:
                yield ConnectorFailure(
                    failed_document=DocumentFailure(
                        document_id=f"{ticket.get('id')}",
                        document_link=ticket.get("url", ""),
                    ),
                    failure_message=str(e),
                    exception=e,
                )
                continue

            if new_author_map:
                author_map.update(new_author_map)

            doc_batch.append(document)

        if not has_more:
            yield from doc_batch
            checkpoint.has_more = False
            return checkpoint

        yield from doc_batch
        checkpoint.next_start_time_tickets = next_start_time
        last_doc_updated_at = doc_batch[-1].doc_updated_at if doc_batch else None
        checkpoint.has_more = bool(
            end is None
            or last_doc_updated_at is None
            or last_doc_updated_at.timestamp() <= end
        )
        checkpoint.cached_author_map = (
            author_map if len(author_map) <= MAX_AUTHOR_MAP_SIZE else None
        )
        return checkpoint

    def retrieve_all_slim_documents(
        self,
        start: SecondsSinceUnixEpoch | None = None,
        end: SecondsSinceUnixEpoch | None = None,
        callback: IndexingHeartbeatInterface | None = None,
    ) -> GenerateSlimDocumentOutput:
        slim_doc_batch: list[SlimDocument] = []
        if self.content_type == "articles":
            articles = _get_articles(
                self.client, start_time=int(start) if start else None
            )
            for article in articles:
                slim_doc_batch.append(
                    SlimDocument(
                        id=f"article:{article['id']}",
                    )
                )
                if len(slim_doc_batch) >= _SLIM_BATCH_SIZE:
                    yield slim_doc_batch
                    slim_doc_batch = []
        elif self.content_type == "tickets":
            tickets = _get_tickets(
                self.client, start_time=int(start) if start else None
            )
            for ticket in tickets:
                slim_doc_batch.append(
                    SlimDocument(
                        id=f"zendesk_ticket_{ticket['id']}",
                    )
                )
                if len(slim_doc_batch) >= _SLIM_BATCH_SIZE:
                    yield slim_doc_batch
                    slim_doc_batch = []
        else:
            raise ValueError(f"Unsupported content_type: {self.content_type}")
        if slim_doc_batch:
            yield slim_doc_batch

    @override
    def validate_connector_settings(self) -> None:
        if self.client is None:
            raise ZendeskCredentialsNotSetUpError()

        try:
            _get_article_page(self.client, start_time=0)
        except HTTPError as e:
            # Check for HTTP status codes
            if e.response.status_code == 401:
                raise CredentialExpiredError(
                    "Your Zendesk credentials appear to be invalid or expired (HTTP 401)."
                ) from e
            elif e.response.status_code == 403:
                raise InsufficientPermissionsError(
                    "Your Zendesk token does not have sufficient permissions (HTTP 403)."
                ) from e
            elif e.response.status_code == 404:
                raise ConnectorValidationError(
                    "Zendesk resource not found (HTTP 404)."
                ) from e
            else:
                raise ConnectorValidationError(
                    f"Unexpected Zendesk error (status={e.response.status_code}): {e}"
                ) from e

    @override
    def validate_checkpoint_json(
        self, checkpoint_json: str
    ) -> ZendeskConnectorCheckpoint:
        return ZendeskConnectorCheckpoint.model_validate_json(checkpoint_json)

    @override
    def build_dummy_checkpoint(self) -> ZendeskConnectorCheckpoint:
        return ZendeskConnectorCheckpoint(
            after_cursor_articles=None,
            next_start_time_tickets=None,
            cached_author_map=None,
            cached_content_tags=None,
            has_more=True,
        )


if __name__ == "__main__":
    import os

    connector = ZendeskConnector()
    connector.load_credentials(
        {
            "zendesk_subdomain": os.environ["ZENDESK_SUBDOMAIN"],
            "zendesk_email": os.environ["ZENDESK_EMAIL"],
            "zendesk_token": os.environ["ZENDESK_TOKEN"],
        }
    )

    current = time.time()
    one_day_ago = current - 24 * 60 * 60  # 1 day
    document_batches = connector.load_from_checkpoint(
        one_day_ago, current, connector.build_dummy_checkpoint()
    )

    print(next(document_batches))
