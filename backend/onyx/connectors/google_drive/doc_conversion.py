import io
from datetime import datetime
from typing import Any
from typing import cast

from googleapiclient.errors import HttpError  # type: ignore
from googleapiclient.http import MediaIoBaseDownload  # type: ignore

from onyx.configs.constants import DocumentSource
from onyx.configs.constants import FileOrigin
from onyx.connectors.google_drive.constants import DRIVE_FOLDER_TYPE
from onyx.connectors.google_drive.constants import DRIVE_SHORTCUT_TYPE
from onyx.connectors.google_drive.models import GDriveMimeType
from onyx.connectors.google_drive.models import GoogleDriveFileType
from onyx.connectors.google_drive.section_extraction import get_document_sections
from onyx.connectors.google_drive.section_extraction import HEADING_DELIMITER
from onyx.connectors.google_utils.resources import get_drive_service
from onyx.connectors.google_utils.resources import get_google_docs_service
from onyx.connectors.google_utils.resources import GoogleDriveService
from onyx.connectors.models import ConnectorFailure
from onyx.connectors.models import Document
from onyx.connectors.models import DocumentFailure
from onyx.connectors.models import ImageSection
from onyx.connectors.models import SlimDocument
from onyx.connectors.models import TextSection
from onyx.db.engine import get_session_with_current_tenant
from onyx.file_processing.extract_file_text import docx_to_text_and_images
from onyx.file_processing.extract_file_text import extract_file_text
from onyx.file_processing.extract_file_text import pptx_to_text
from onyx.file_processing.extract_file_text import read_pdf_file
from onyx.file_processing.extract_file_text import xlsx_to_text
from onyx.file_processing.file_validation import is_valid_image_type
from onyx.file_processing.image_summarization import summarize_image_with_error_handling
from onyx.file_processing.image_utils import store_image_and_create_section
from onyx.llm.interfaces import LLM
from onyx.utils.lazy import lazy_eval
from onyx.utils.logger import setup_logger

logger = setup_logger()

# This is not a standard valid unicode char, it is used by the docs advanced API to
# represent smart chips (elements like dates and doc links).
SMART_CHIP_CHAR = "\ue907"
WEB_VIEW_LINK_KEY = "webViewLink"

MAX_RETRIEVER_EMAILS = 20

# Mapping of Google Drive mime types to export formats
GOOGLE_MIME_TYPES_TO_EXPORT = {
    GDriveMimeType.DOC.value: "text/plain",
    GDriveMimeType.SPREADSHEET.value: "text/csv",
    GDriveMimeType.PPT.value: "text/plain",
}

# Define Google MIME types mapping
GOOGLE_MIME_TYPES = {
    GDriveMimeType.DOC.value: "text/plain",
    GDriveMimeType.SPREADSHEET.value: "text/csv",
    GDriveMimeType.PPT.value: "text/plain",
}


def _summarize_drive_image(
    image_data: bytes, image_name: str, image_analysis_llm: LLM | None
) -> str:
    """
    Summarize the given image using the provided LLM.
    """
    if not image_analysis_llm:
        return ""

    return (
        summarize_image_with_error_handling(
            llm=image_analysis_llm,
            image_data=image_data,
            context_name=image_name,
        )
        or ""
    )


def is_gdrive_image_mime_type(mime_type: str) -> bool:
    """
    Return True if the mime_type is a common image type in GDrive.
    (e.g. 'image/png', 'image/jpeg')
    """
    return is_valid_image_type(mime_type)


def download_request(service: GoogleDriveService, file_id: str) -> bytes:
    """
    Download the file from Google Drive.
    """
    # For other file types, download the file
    # Use the correct API call for downloading files
    request = service.files().get_media(fileId=file_id)
    response_bytes = io.BytesIO()
    downloader = MediaIoBaseDownload(response_bytes, request)
    done = False
    while not done:
        _, done = downloader.next_chunk()

    response = response_bytes.getvalue()
    if not response:
        logger.warning(f"Failed to download {file_id}")
        return bytes()
    return response


def _download_and_extract_sections_basic(
    file: dict[str, str],
    service: GoogleDriveService,
    allow_images: bool,
) -> list[TextSection | ImageSection]:
    """Extract text and images from a Google Drive file."""
    file_id = file["id"]
    file_name = file["name"]
    mime_type = file["mimeType"]
    link = file.get(WEB_VIEW_LINK_KEY, "")

    # skip images if not explicitly enabled
    if not allow_images and is_gdrive_image_mime_type(mime_type):
        return []

    # For Google Docs, Sheets, and Slides, export as plain text
    if mime_type in GOOGLE_MIME_TYPES_TO_EXPORT:
        export_mime_type = GOOGLE_MIME_TYPES_TO_EXPORT[mime_type]
        # Use the correct API call for exporting files
        request = service.files().export_media(
            fileId=file_id, mimeType=export_mime_type
        )
        response_bytes = io.BytesIO()
        downloader = MediaIoBaseDownload(response_bytes, request)
        done = False
        while not done:
            _, done = downloader.next_chunk()

        response = response_bytes.getvalue()
        if not response:
            logger.warning(f"Failed to export {file_name} as {export_mime_type}")
            return []

        text = response.decode("utf-8")
        return [TextSection(link=link, text=text)]

    # For other file types, download the file
    # Use the correct API call for downloading files
    response_call = lazy_eval(lambda: download_request(service, file_id))

    # Process based on mime type
    if mime_type == "text/plain":
        text = response_call().decode("utf-8")
        return [TextSection(link=link, text=text)]

    elif (
        mime_type
        == "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ):
        text, _ = docx_to_text_and_images(io.BytesIO(response_call()))
        return [TextSection(link=link, text=text)]

    elif (
        mime_type == "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    ):
        text = xlsx_to_text(io.BytesIO(response_call()))
        return [TextSection(link=link, text=text)]

    elif (
        mime_type
        == "application/vnd.openxmlformats-officedocument.presentationml.presentation"
    ):
        text = pptx_to_text(io.BytesIO(response_call()))
        return [TextSection(link=link, text=text)]

    elif is_gdrive_image_mime_type(mime_type):
        # For images, store them for later processing
        sections: list[TextSection | ImageSection] = []
        try:
            with get_session_with_current_tenant() as db_session:
                section, embedded_id = store_image_and_create_section(
                    db_session=db_session,
                    image_data=response_call(),
                    file_name=file_id,
                    display_name=file_name,
                    media_type=mime_type,
                    file_origin=FileOrigin.CONNECTOR,
                    link=link,
                )
                sections.append(section)
        except Exception as e:
            logger.error(f"Failed to process image {file_name}: {e}")
        return sections

    elif mime_type == "application/pdf":
        text, _pdf_meta, images = read_pdf_file(io.BytesIO(response_call()))
        pdf_sections: list[TextSection | ImageSection] = [
            TextSection(link=link, text=text)
        ]

        # Process embedded images in the PDF
        try:
            with get_session_with_current_tenant() as db_session:
                for idx, (img_data, img_name) in enumerate(images):
                    section, embedded_id = store_image_and_create_section(
                        db_session=db_session,
                        image_data=img_data,
                        file_name=f"{file_id}_img_{idx}",
                        display_name=img_name or f"{file_name} - image {idx}",
                        file_origin=FileOrigin.CONNECTOR,
                    )
                    pdf_sections.append(section)
        except Exception as e:
            logger.error(f"Failed to process PDF images in {file_name}: {e}")
        return pdf_sections

    else:
        # For unsupported file types, try to extract text
        if mime_type in [
            "application/vnd.google-apps.video",
            "application/vnd.google-apps.audio",
            "application/zip",
        ]:
            return []
        # For unsupported file types, try to extract text
        try:
            text = extract_file_text(io.BytesIO(response_call()), file_name)
            return [TextSection(link=link, text=text)]
        except Exception as e:
            logger.warning(f"Failed to extract text from {file_name}: {e}")
            return []


def _find_nth(haystack: str, needle: str, n: int, start: int = 0) -> int:
    start = haystack.find(needle, start)
    while start >= 0 and n > 1:
        start = haystack.find(needle, start + len(needle))
        n -= 1
    return start


def align_basic_advanced(
    basic_sections: list[TextSection | ImageSection], adv_sections: list[TextSection]
) -> list[TextSection | ImageSection]:
    """Align the basic sections with the advanced sections.
    In particular, the basic sections contain all content of the file,
    including smart chips like dates and doc links. The advanced sections
    are separated by section headers and contain header-based links that
    improve user experience when they click on the source in the UI.

    There are edge cases in text matching (i.e. the heading is a smart chip or
    there is a smart chip in the doc with text containing the actual heading text)
    that make the matching imperfect; this is hence done on a best-effort basis.
    """
    if len(adv_sections) <= 1:
        return basic_sections  # no benefit from aligning

    basic_full_text = "".join(
        [section.text for section in basic_sections if isinstance(section, TextSection)]
    )
    new_sections: list[TextSection | ImageSection] = []
    heading_start = 0
    for adv_ind in range(1, len(adv_sections)):
        heading = adv_sections[adv_ind].text.split(HEADING_DELIMITER)[0]
        # retrieve the longest part of the heading that is not a smart chip
        heading_key = max(heading.split(SMART_CHIP_CHAR), key=len).strip()
        if heading_key == "":
            logger.warning(
                f"Cannot match heading: {heading}, its link will come from the following section"
            )
            continue
        heading_offset = heading.find(heading_key)

        # count occurrences of heading str in previous section
        heading_count = adv_sections[adv_ind - 1].text.count(heading_key)

        prev_start = heading_start
        heading_start = (
            _find_nth(basic_full_text, heading_key, heading_count, start=prev_start)
            - heading_offset
        )
        if heading_start < 0:
            logger.warning(
                f"Heading key {heading_key} from heading {heading} not found in basic text"
            )
            heading_start = prev_start
            continue

        new_sections.append(
            TextSection(
                link=adv_sections[adv_ind - 1].link,
                text=basic_full_text[prev_start:heading_start],
            )
        )

    # handle last section
    new_sections.append(
        TextSection(link=adv_sections[-1].link, text=basic_full_text[heading_start:])
    )
    return new_sections


def convert_drive_item_to_document(
    creds: Any,
    allow_images: bool,
    size_threshold: int,
    retriever_emails: list[str],
    file: GoogleDriveFileType,
) -> Document | ConnectorFailure | None:
    """
    Attempt to convert a drive item to a document with each retriever email
    in order. returns upon a successful retrieval or a non-403 error.

    We used to always get the user email from the file owners when available,
    but this was causing issues with shared folders where the owner was not included in the service account
    now we use the email of the account that successfully listed the file. There are cases where a
    user that can list a file cannot download it, so we retry with file owners and admin email.
    """
    first_error = None
    doc_or_failure = None
    retriever_emails = retriever_emails[:MAX_RETRIEVER_EMAILS]
    # use seen instead of list(set()) to avoid re-ordering the retriever emails
    seen = set()
    for retriever_email in retriever_emails:
        if retriever_email in seen:
            continue
        seen.add(retriever_email)
        doc_or_failure = _convert_drive_item_to_document(
            creds, allow_images, size_threshold, retriever_email, file
        )

        # There are a variety of permissions-based errors that occasionally occur
        # when retrieving files. Often when these occur, there is another user
        # that can successfully retrieve the file, so we try the next user.
        if (
            doc_or_failure is None
            or isinstance(doc_or_failure, Document)
            or not (
                isinstance(doc_or_failure.exception, HttpError)
                and doc_or_failure.exception.status_code in [401, 403, 404]
            )
        ):
            return doc_or_failure

        if first_error is None:
            first_error = doc_or_failure
        else:
            first_error.failure_message += f"\n\n{doc_or_failure.failure_message}"

    if (
        first_error
        and isinstance(first_error.exception, HttpError)
        and first_error.exception.status_code == 403
    ):
        # This SHOULD happen very rarely, and we don't want to break the indexing process when
        # a high volume of 403s occurs early. We leave a verbose log to help investigate.
        logger.error(
            f"Skipping file id: {file.get('id')} name: {file.get('name')} due to 403 error."
            f"Attempted to retrieve with {retriever_emails},"
            f"got the following errors: {first_error.failure_message}"
        )
        return None
    return first_error


def _convert_drive_item_to_document(
    creds: Any,
    allow_images: bool,
    size_threshold: int,
    retriever_email: str,
    file: GoogleDriveFileType,
) -> Document | ConnectorFailure | None:
    """
    Main entry point for converting a Google Drive file => Document object.
    """
    doc_id = file.get(WEB_VIEW_LINK_KEY, "")
    sections: list[TextSection | ImageSection] = []
    # Only construct these services when needed
    drive_service = lazy_eval(
        lambda: get_drive_service(creds, user_email=retriever_email)
    )
    docs_service = lazy_eval(
        lambda: get_google_docs_service(creds, user_email=retriever_email)
    )

    try:
        # skip shortcuts or folders
        if file.get("mimeType") in [DRIVE_SHORTCUT_TYPE, DRIVE_FOLDER_TYPE]:
            logger.info("Skipping shortcut/folder.")
            return None

        # If it's a Google Doc, we might do advanced parsing
        if file.get("mimeType") == GDriveMimeType.DOC.value:
            try:
                # get_document_sections is the advanced approach for Google Docs
                doc_sections = get_document_sections(
                    docs_service=docs_service(),
                    doc_id=file.get("id", ""),
                )
                if doc_sections:
                    sections = cast(list[TextSection | ImageSection], doc_sections)
                    if any(SMART_CHIP_CHAR in section.text for section in doc_sections):
                        basic_sections = _download_and_extract_sections_basic(
                            file, drive_service(), allow_images
                        )
                        sections = align_basic_advanced(basic_sections, doc_sections)

            except Exception as e:
                logger.warning(
                    f"Error in advanced parsing: {e}. Falling back to basic extraction."
                )

        size_str = file.get("size")
        if size_str:
            try:
                size_int = int(size_str)
            except ValueError:
                logger.warning(f"Parsing string to int failed: size_str={size_str}")
            else:
                if size_int > size_threshold:
                    logger.warning(
                        f"{file.get('name')} exceeds size threshold of {size_threshold}. Skipping."
                    )
                    return None

        # If we don't have sections yet, use the basic extraction method
        if not sections:
            sections = _download_and_extract_sections_basic(
                file, drive_service(), allow_images
            )

        # If we still don't have any sections, skip this file
        if not sections:
            logger.warning(f"No content extracted from {file.get('name')}. Skipping.")
            return None

        doc_id = file[WEB_VIEW_LINK_KEY]

        # Create the document
        return Document(
            id=doc_id,
            sections=sections,
            source=DocumentSource.GOOGLE_DRIVE,
            semantic_identifier=file.get("name", ""),
            metadata={
                "owner_names": ", ".join(
                    owner.get("displayName", "") for owner in file.get("owners", [])
                ),
            },
            doc_updated_at=datetime.fromisoformat(
                file.get("modifiedTime", "").replace("Z", "+00:00")
            ),
        )
    except Exception as e:
        file_name = file.get("name")
        error_str = (
            f"Error converting file '{file_name}' to Document as {retriever_email}: {e}"
        )
        if isinstance(e, HttpError) and e.status_code == 403:
            logger.warning(
                f"Uncommon permissions error while downloading file. User "
                f"{retriever_email} was able to see file {file_name} "
                "but cannot download it."
            )
            logger.warning(error_str)

        return ConnectorFailure(
            failed_document=DocumentFailure(
                document_id=doc_id,
                document_link=(
                    sections[0].link if sections else None
                ),  # TODO: see if this is the best way to get a link
            ),
            failed_entity=None,
            failure_message=error_str,
            exception=e,
        )


def build_slim_document(file: GoogleDriveFileType) -> SlimDocument | None:
    if file.get("mimeType") in [DRIVE_FOLDER_TYPE, DRIVE_SHORTCUT_TYPE]:
        return None
    return SlimDocument(
        id=file[WEB_VIEW_LINK_KEY],
        perm_sync_data={
            "doc_id": file.get("id"),
            "drive_id": file.get("driveId"),
            "permissions": file.get("permissions", []),
            "permission_ids": file.get("permissionIds", []),
            "name": file.get("name"),
            "owner_email": file.get("owners", [{}])[0].get("emailAddress"),
        },
    )
