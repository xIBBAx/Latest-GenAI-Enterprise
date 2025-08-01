import base64
from collections.abc import Callable
from io import BytesIO
from typing import cast
from uuid import uuid4

import requests
from sqlalchemy.orm import Session

from onyx.configs.constants import FileOrigin
from onyx.db.engine import get_session_with_current_tenant
from onyx.db.models import ChatMessage
from onyx.db.models import UserFile
from onyx.db.models import UserFolder
from onyx.file_processing.extract_file_text import IMAGE_MEDIA_TYPES
from onyx.file_store.file_store import get_default_file_store
from onyx.file_store.models import ChatFileType
from onyx.file_store.models import FileDescriptor
from onyx.file_store.models import InMemoryChatFile
from onyx.utils.b64 import get_image_type
from onyx.utils.logger import setup_logger
from onyx.utils.threadpool_concurrency import run_functions_tuples_in_parallel

logger = setup_logger()


def user_file_id_to_plaintext_file_name(user_file_id: int) -> str:
    """Generate a consistent file name for storing plaintext content of a user file."""
    return f"plaintext_{user_file_id}"


def store_user_file_plaintext(
    user_file_id: int, plaintext_content: str, db_session: Session
) -> bool:
    """
    Store plaintext content for a user file in the file store.

    Args:
        user_file_id: The ID of the user file
        plaintext_content: The plaintext content to store
        db_session: The database session

    Returns:
        bool: True if storage was successful, False otherwise
    """
    # Skip empty content
    if not plaintext_content:
        return False

    # Get plaintext file name
    plaintext_file_name = user_file_id_to_plaintext_file_name(user_file_id)

    # Store the plaintext in the file store
    file_store = get_default_file_store(db_session)
    file_content = BytesIO(plaintext_content.encode("utf-8"))
    try:
        file_store.save_file(
            file_name=plaintext_file_name,
            content=file_content,
            display_name=f"Plaintext for user file {user_file_id}",
            file_origin=FileOrigin.PLAINTEXT_CACHE,
            file_type="text/plain",
            commit=False,
        )
        return True
    except Exception as e:
        logger.warning(f"Failed to store plaintext for user file {user_file_id}: {e}")
        return False


def load_chat_file(
    file_descriptor: FileDescriptor, db_session: Session
) -> InMemoryChatFile:
    file_io = get_default_file_store(db_session).read_file(
        file_descriptor["id"], mode="b"
    )
    return InMemoryChatFile(
        file_id=file_descriptor["id"],
        content=file_io.read(),
        file_type=file_descriptor["type"],
        filename=file_descriptor.get("name"),
    )


def load_all_chat_files(
    chat_messages: list[ChatMessage],
    file_descriptors: list[FileDescriptor],
    db_session: Session,
) -> list[InMemoryChatFile]:
    file_descriptors_for_history: list[FileDescriptor] = []
    for chat_message in chat_messages:
        if chat_message.files:
            file_descriptors_for_history.extend(chat_message.files)

    files = cast(
        list[InMemoryChatFile],
        run_functions_tuples_in_parallel(
            [
                (load_chat_file, (file, db_session))
                for file in file_descriptors + file_descriptors_for_history
            ]
        ),
    )
    return files


def load_user_folder(folder_id: int, db_session: Session) -> list[InMemoryChatFile]:
    user_files = (
        db_session.query(UserFile).filter(UserFile.folder_id == folder_id).all()
    )
    return [load_user_file(file.id, db_session) for file in user_files]


def load_user_file(file_id: int, db_session: Session) -> InMemoryChatFile:
    chat_file_type = ChatFileType.USER_KNOWLEDGE
    status = "not_loaded"

    user_file = db_session.query(UserFile).filter(UserFile.id == file_id).first()
    if not user_file:
        raise ValueError(f"User file with id {file_id} not found")

    # Try to load plaintext version first
    file_store = get_default_file_store(db_session)
    plaintext_file_name = user_file_id_to_plaintext_file_name(file_id)

    # check for plain text normalized version first, then use original file otherwise
    try:
        file_io = file_store.read_file(plaintext_file_name, mode="b")
        chat_file = InMemoryChatFile(
            file_id=str(user_file.file_id),
            content=file_io.read(),
            file_type=ChatFileType.USER_KNOWLEDGE,
            filename=user_file.name,
        )
        status = "plaintext"
        return chat_file
    except Exception:
        # Fall back to original file if plaintext not available
        file_io = file_store.read_file(user_file.file_id, mode="b")
        file_record = file_store.read_file_record(user_file.file_id)
        if file_record.file_type in IMAGE_MEDIA_TYPES:
            chat_file_type = ChatFileType.IMAGE

        chat_file = InMemoryChatFile(
            file_id=str(user_file.file_id),
            content=file_io.read(),
            file_type=chat_file_type,
            filename=user_file.name,
        )
        status = "original"
        return chat_file
    finally:
        logger.debug(
            f"load_user_file finished: file_id={user_file.file_id} "
            f"chat_file_type={chat_file_type} "
            f"status={status}"
        )


def load_in_memory_chat_files(
    user_file_ids: list[int],
    user_folder_ids: list[int],
    db_session: Session,
) -> list[InMemoryChatFile]:
    """
    Loads the actual content of user files specified by individual IDs and those
    within specified folder IDs into memory.

    Args:
        user_file_ids: A list of specific UserFile IDs to load.
        user_folder_ids: A list of UserFolder IDs. All UserFiles within these folders will be loaded.
        db_session: The SQLAlchemy database session.

    Returns:
        A list of InMemoryChatFile objects, each containing the file content (as bytes),
        file ID, file type, and filename. Prioritizes loading plaintext versions if available.
    """
    # Use parallel execution to load files concurrently
    return cast(
        list[InMemoryChatFile],
        run_functions_tuples_in_parallel(
            # 1. Load files specified by individual IDs
            [(load_user_file, (file_id, db_session)) for file_id in user_file_ids]
        )
        # 2. Load all files within specified folders
        + [
            file
            for folder_id in user_folder_ids
            for file in load_user_folder(folder_id, db_session)
        ],
    )


def get_user_files(
    user_file_ids: list[int],
    user_folder_ids: list[int],
    db_session: Session,
) -> list[UserFile]:
    """
    Fetches UserFile database records based on provided file and folder IDs.

    Args:
        user_file_ids: A list of specific UserFile IDs to fetch.
        user_folder_ids: A list of UserFolder IDs. All UserFiles within these folders will be fetched.
        db_session: The SQLAlchemy database session.

    Returns:
        A list containing UserFile SQLAlchemy model objects corresponding to the
        specified file IDs and all files within the specified folder IDs.
        It does NOT return the actual file content.
    """
    user_files: list[UserFile] = []

    # 1. Fetch UserFile records for specific file IDs
    for user_file_id in user_file_ids:
        # Query the database for a UserFile with the matching ID
        user_file = (
            db_session.query(UserFile).filter(UserFile.id == user_file_id).first()
        )
        # If found, add it to the list
        if user_file is not None:
            user_files.append(user_file)

    # 2. Fetch UserFile records for all files within specified folder IDs
    for user_folder_id in user_folder_ids:
        # Query the database for all UserFiles belonging to the current folder ID
        # and extend the list with the results
        user_files.extend(
            db_session.query(UserFile)
            .filter(UserFile.folder_id == user_folder_id)
            .all()
        )

    # 3. Return the combined list of UserFile database objects
    return user_files


def save_file_from_url(url: str) -> str:
    """NOTE: using multiple sessions here, since this is often called
    using multithreading. In practice, sharing a session has resulted in
    weird errors."""
    with get_session_with_current_tenant() as db_session:
        response = requests.get(url)
        response.raise_for_status()

        unique_id = str(uuid4())

        file_io = BytesIO(response.content)
        file_store = get_default_file_store(db_session)
        file_store.save_file(
            file_name=unique_id,
            content=file_io,
            display_name="GeneratedImage",
            file_origin=FileOrigin.CHAT_IMAGE_GEN,
            file_type="image/png;base64",
            commit=True,
        )
        return unique_id


def save_file_from_base64(base64_string: str) -> str:
    with get_session_with_current_tenant() as db_session:
        unique_id = str(uuid4())
        file_store = get_default_file_store(db_session)
        file_store.save_file(
            file_name=unique_id,
            content=BytesIO(base64.b64decode(base64_string)),
            display_name="GeneratedImage",
            file_origin=FileOrigin.CHAT_IMAGE_GEN,
            file_type=get_image_type(base64_string),
            commit=True,
        )
        return unique_id


def save_file(
    url: str | None = None,
    base64_data: str | None = None,
) -> str:
    """Save a file from either a URL or base64 encoded string.

    Args:
        url: URL to download file from
        base64_data: Base64 encoded file data

    Returns:
        The unique ID of the saved file

    Raises:
        ValueError: If neither url nor base64_data is provided, or if both are provided
    """
    if url is not None and base64_data is not None:
        raise ValueError("Cannot specify both url and base64_data")

    if url is not None:
        return save_file_from_url(url)
    elif base64_data is not None:
        return save_file_from_base64(base64_data)
    else:
        raise ValueError("Must specify either url or base64_data")


def save_files(urls: list[str], base64_files: list[str]) -> list[str]:
    # NOTE: be explicit about typing so that if we change things, we get notified
    funcs: list[
        tuple[
            Callable[[str | None, str | None], str],
            tuple[str | None, str | None],
        ]
    ] = [(save_file, (url, None)) for url in urls] + [
        (save_file, (None, base64_file)) for base64_file in base64_files
    ]

    return run_functions_tuples_in_parallel(funcs)


def load_all_persona_files_for_chat(
    persona_id: int, db_session: Session
) -> tuple[list[InMemoryChatFile], list[int]]:
    from onyx.db.models import Persona
    from sqlalchemy.orm import joinedload

    persona = (
        db_session.query(Persona)
        .filter(Persona.id == persona_id)
        .options(
            joinedload(Persona.user_files),
            joinedload(Persona.user_folders).joinedload(UserFolder.files),
        )
        .one()
    )

    persona_file_calls = [
        (load_user_file, (user_file.id, db_session)) for user_file in persona.user_files
    ]
    persona_loaded_files = run_functions_tuples_in_parallel(persona_file_calls)

    persona_folder_files = []
    persona_folder_file_ids = []
    for user_folder in persona.user_folders:
        folder_files = load_user_folder(user_folder.id, db_session)
        persona_folder_files.extend(folder_files)
        persona_folder_file_ids.extend([file.id for file in user_folder.files])

    persona_files = list(persona_loaded_files) + persona_folder_files
    persona_file_ids = [
        file.id for file in persona.user_files
    ] + persona_folder_file_ids

    return persona_files, persona_file_ids
