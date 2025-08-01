import os
from datetime import datetime
from datetime import timezone
from io import BytesIO
from typing import Any
from typing import Optional

import boto3  # type: ignore
from botocore.client import Config  # type: ignore
from botocore.exceptions import ClientError
from botocore.exceptions import NoCredentialsError
from botocore.exceptions import PartialCredentialsError
from mypy_boto3_s3 import S3Client  # type: ignore

from onyx.configs.app_configs import INDEX_BATCH_SIZE
from onyx.configs.constants import BlobType
from onyx.configs.constants import DocumentSource
from onyx.configs.constants import FileOrigin
from onyx.connectors.exceptions import ConnectorValidationError
from onyx.connectors.exceptions import CredentialExpiredError
from onyx.connectors.exceptions import InsufficientPermissionsError
from onyx.connectors.exceptions import UnexpectedValidationError
from onyx.connectors.interfaces import GenerateDocumentsOutput
from onyx.connectors.interfaces import LoadConnector
from onyx.connectors.interfaces import PollConnector
from onyx.connectors.interfaces import SecondsSinceUnixEpoch
from onyx.connectors.models import ConnectorMissingCredentialError
from onyx.connectors.models import Document
from onyx.connectors.models import TextSection
from onyx.db.engine import get_session_with_current_tenant
from onyx.file_processing.extract_file_text import extract_file_text
from onyx.file_processing.extract_file_text import get_file_ext
from onyx.file_processing.extract_file_text import is_accepted_file_ext
from onyx.file_processing.extract_file_text import OnyxExtensionType
from onyx.file_processing.image_utils import store_image_and_create_section
from onyx.utils.logger import setup_logger

logger = setup_logger()


class BlobStorageConnector(LoadConnector, PollConnector):
    def __init__(
        self,
        bucket_type: str,
        bucket_name: str,
        prefix: str = "",
        batch_size: int = INDEX_BATCH_SIZE,
    ) -> None:
        self.bucket_type: BlobType = BlobType(bucket_type)
        self.bucket_name = bucket_name
        self.prefix = prefix if not prefix or prefix.endswith("/") else prefix + "/"
        self.batch_size = batch_size
        self.s3_client: Optional[S3Client] = None
        self._allow_images: bool | None = None

    def set_allow_images(self, allow_images: bool) -> None:
        """Set whether to process images in this connector."""
        logger.info(f"Setting allow_images to {allow_images}.")
        self._allow_images = allow_images

    def load_credentials(self, credentials: dict[str, Any]) -> dict[str, Any] | None:
        """Checks for boto3 credentials based on the bucket type.
        (1) R2: Access Key ID, Secret Access Key, Account ID
        (2) S3: AWS Access Key ID, AWS Secret Access Key
        (3) GOOGLE_CLOUD_STORAGE: Access Key ID, Secret Access Key, Project ID
        (4) OCI_STORAGE: Namespace, Region, Access Key ID, Secret Access Key

        For each bucket type, the method initializes the appropriate S3 client:
        - R2: Uses Cloudflare R2 endpoint with S3v4 signature
        - S3: Creates a standard boto3 S3 client
        - GOOGLE_CLOUD_STORAGE: Uses Google Cloud Storage endpoint
        - OCI_STORAGE: Uses Oracle Cloud Infrastructure Object Storage endpoint

        Raises ConnectorMissingCredentialError if required credentials are missing.
        Raises ValueError for unsupported bucket types.
        """

        logger.debug(
            f"Loading credentials for {self.bucket_name} or type {self.bucket_type}"
        )

        if self.bucket_type == BlobType.R2:
            if not all(
                credentials.get(key)
                for key in ["r2_access_key_id", "r2_secret_access_key", "account_id"]
            ):
                raise ConnectorMissingCredentialError("Cloudflare R2")
            self.s3_client = boto3.client(
                "s3",
                endpoint_url=f"https://{credentials['account_id']}.r2.cloudflarestorage.com",
                aws_access_key_id=credentials["r2_access_key_id"],
                aws_secret_access_key=credentials["r2_secret_access_key"],
                region_name="auto",
                config=Config(signature_version="s3v4"),
            )

        elif self.bucket_type == BlobType.S3:
            if not all(
                credentials.get(key)
                for key in ["aws_access_key_id", "aws_secret_access_key"]
            ):
                raise ConnectorMissingCredentialError("Amazon S3")

            session = boto3.Session(
                aws_access_key_id=credentials["aws_access_key_id"],
                aws_secret_access_key=credentials["aws_secret_access_key"],
            )
            self.s3_client = session.client("s3")

        elif self.bucket_type == BlobType.GOOGLE_CLOUD_STORAGE:
            if not all(
                credentials.get(key) for key in ["access_key_id", "secret_access_key"]
            ):
                raise ConnectorMissingCredentialError("Google Cloud Storage")

            self.s3_client = boto3.client(
                "s3",
                endpoint_url="https://storage.googleapis.com",
                aws_access_key_id=credentials["access_key_id"],
                aws_secret_access_key=credentials["secret_access_key"],
                region_name="auto",
            )

        elif self.bucket_type == BlobType.OCI_STORAGE:
            if not all(
                credentials.get(key)
                for key in ["namespace", "region", "access_key_id", "secret_access_key"]
            ):
                raise ConnectorMissingCredentialError("Oracle Cloud Infrastructure")

            self.s3_client = boto3.client(
                "s3",
                endpoint_url=f"https://{credentials['namespace']}.compat.objectstorage.{credentials['region']}.oraclecloud.com",
                aws_access_key_id=credentials["access_key_id"],
                aws_secret_access_key=credentials["secret_access_key"],
                region_name=credentials["region"],
            )

        else:
            raise ValueError(f"Unsupported bucket type: {self.bucket_type}")

        return None

    def _download_object(self, key: str) -> bytes:
        if self.s3_client is None:
            raise ConnectorMissingCredentialError("Blob storage")
        object = self.s3_client.get_object(Bucket=self.bucket_name, Key=key)
        return object["Body"].read()

    # NOTE: Left in as may be useful for one-off access to documents and sharing across orgs.
    # def _get_presigned_url(self, key: str) -> str:
    #     if self.s3_client is None:
    #         raise ConnectorMissingCredentialError("Blog storage")

    #     url = self.s3_client.generate_presigned_url(
    #         "get_object",
    #         Params={"Bucket": self.bucket_name, "Key": key},
    #         ExpiresIn=self.presign_length,
    #     )
    #     return url

    def _get_blob_link(self, key: str) -> str:
        if self.s3_client is None:
            raise ConnectorMissingCredentialError("Blob storage")

        if self.bucket_type == BlobType.R2:
            account_id = self.s3_client.meta.endpoint_url.split("//")[1].split(".")[0]
            return f"https://{account_id}.r2.cloudflarestorage.com/{self.bucket_name}/{key}"

        elif self.bucket_type == BlobType.S3:
            region = self.s3_client.meta.region_name
            return f"https://{self.bucket_name}.s3.{region}.amazonaws.com/{key}"

        elif self.bucket_type == BlobType.GOOGLE_CLOUD_STORAGE:
            return f"https://storage.cloud.google.com/{self.bucket_name}/{key}"

        elif self.bucket_type == BlobType.OCI_STORAGE:
            namespace = self.s3_client.meta.endpoint_url.split("//")[1].split(".")[0]
            region = self.s3_client.meta.region_name
            return f"https://objectstorage.{region}.oraclecloud.com/n/{namespace}/b/{self.bucket_name}/o/{key}"

        else:
            raise ValueError(f"Unsupported bucket type: {self.bucket_type}")

    def _yield_blob_objects(
        self,
        start: datetime,
        end: datetime,
    ) -> GenerateDocumentsOutput:
        if self.s3_client is None:
            raise ConnectorMissingCredentialError("Blob storage")

        paginator = self.s3_client.get_paginator("list_objects_v2")
        pages = paginator.paginate(Bucket=self.bucket_name, Prefix=self.prefix)

        batch: list[Document] = []
        for page in pages:
            if "Contents" not in page:
                continue

            for obj in page["Contents"]:
                if obj["Key"].endswith("/"):
                    continue

                last_modified = obj["LastModified"].replace(tzinfo=timezone.utc)

                if not start <= last_modified <= end:
                    continue

                file_name = os.path.basename(obj["Key"])
                file_ext = get_file_ext(file_name)
                key = obj["Key"]
                link = self._get_blob_link(key)

                # Handle image files
                if is_accepted_file_ext(file_ext, OnyxExtensionType.Multimedia):
                    if not self._allow_images:
                        logger.debug(
                            f"Skipping image file: {key} (image processing not enabled)"
                        )
                        continue

                    # Process the image file
                    try:
                        downloaded_file = self._download_object(key)

                        # TODO: Refactor to avoid direct DB access in connector
                        # This will require broader refactoring across the codebase
                        with get_session_with_current_tenant() as db_session:
                            image_section, _ = store_image_and_create_section(
                                db_session=db_session,
                                image_data=downloaded_file,
                                file_name=f"{self.bucket_type}_{self.bucket_name}_{key.replace('/', '_')}",
                                display_name=file_name,
                                link=link,
                                file_origin=FileOrigin.CONNECTOR,
                            )

                            batch.append(
                                Document(
                                    id=f"{self.bucket_type}:{self.bucket_name}:{key}",
                                    sections=[image_section],
                                    source=DocumentSource(self.bucket_type.value),
                                    semantic_identifier=file_name,
                                    doc_updated_at=last_modified,
                                    metadata={},
                                )
                            )

                            if len(batch) == self.batch_size:
                                yield batch
                                batch = []
                    except Exception:
                        logger.exception(f"Error processing image {key}")
                    continue

                # Handle text and document files
                try:
                    downloaded_file = self._download_object(key)
                    text = extract_file_text(
                        BytesIO(downloaded_file),
                        file_name=file_name,
                        break_on_unprocessable=False,
                    )
                    batch.append(
                        Document(
                            id=f"{self.bucket_type}:{self.bucket_name}:{key}",
                            sections=[TextSection(link=link, text=text)],
                            source=DocumentSource(self.bucket_type.value),
                            semantic_identifier=file_name,
                            doc_updated_at=last_modified,
                            metadata={},
                        )
                    )
                    if len(batch) == self.batch_size:
                        yield batch
                        batch = []

                except Exception:
                    logger.exception(f"Error decoding object {key} as UTF-8")
        if batch:
            yield batch

    def load_from_state(self) -> GenerateDocumentsOutput:
        logger.debug("Loading blob objects")
        return self._yield_blob_objects(
            start=datetime(1970, 1, 1, tzinfo=timezone.utc),
            end=datetime.now(timezone.utc),
        )

    def poll_source(
        self, start: SecondsSinceUnixEpoch, end: SecondsSinceUnixEpoch
    ) -> GenerateDocumentsOutput:
        if self.s3_client is None:
            raise ConnectorMissingCredentialError("Blob storage")

        start_datetime = datetime.fromtimestamp(start, tz=timezone.utc)
        end_datetime = datetime.fromtimestamp(end, tz=timezone.utc)

        for batch in self._yield_blob_objects(start_datetime, end_datetime):
            yield batch

        return None

    def validate_connector_settings(self) -> None:
        if self.s3_client is None:
            raise ConnectorMissingCredentialError(
                "Blob storage credentials not loaded."
            )

        if not self.bucket_name:
            raise ConnectorValidationError(
                "No bucket name was provided in connector settings."
            )

        try:
            # We only fetch one object/page as a light-weight validation step.
            # This ensures we trigger typical S3 permission checks (ListObjectsV2, etc.).
            self.s3_client.list_objects_v2(
                Bucket=self.bucket_name, Prefix=self.prefix, MaxKeys=1
            )

        except NoCredentialsError:
            raise ConnectorMissingCredentialError(
                "No valid blob storage credentials found or provided to boto3."
            )
        except PartialCredentialsError:
            raise ConnectorMissingCredentialError(
                "Partial or incomplete blob storage credentials provided to boto3."
            )
        except ClientError as e:
            error_code = e.response["Error"].get("Code", "")
            status_code = e.response["ResponseMetadata"].get("HTTPStatusCode")

            # Most common S3 error cases
            if error_code in [
                "AccessDenied",
                "InvalidAccessKeyId",
                "SignatureDoesNotMatch",
            ]:
                if status_code == 403 or error_code == "AccessDenied":
                    raise InsufficientPermissionsError(
                        f"Insufficient permissions to list objects in bucket '{self.bucket_name}'. "
                        "Please check your bucket policy and/or IAM policy."
                    )
                if status_code == 401 or error_code == "SignatureDoesNotMatch":
                    raise CredentialExpiredError(
                        "Provided blob storage credentials appear invalid or expired."
                    )

                raise CredentialExpiredError(
                    f"Credential issue encountered ({error_code})."
                )

            if error_code == "NoSuchBucket" or status_code == 404:
                raise ConnectorValidationError(
                    f"Bucket '{self.bucket_name}' does not exist or cannot be found."
                )

            raise ConnectorValidationError(
                f"Unexpected S3 client error (code={error_code}, status={status_code}): {e}"
            )

        except Exception as e:
            # Catch-all for anything not captured by the above
            # Since we are unsure of the error and it may not disable the connector,
            #  raise an unexpected error (does not disable connector)
            raise UnexpectedValidationError(
                f"Unexpected error during blob storage settings validation: {e}"
            )


if __name__ == "__main__":
    credentials_dict = {
        "aws_access_key_id": os.environ.get("AWS_ACCESS_KEY_ID"),
        "aws_secret_access_key": os.environ.get("AWS_SECRET_ACCESS_KEY"),
    }

    # Initialize the connector
    connector = BlobStorageConnector(
        bucket_type=os.environ.get("BUCKET_TYPE") or "s3",
        bucket_name=os.environ.get("BUCKET_NAME") or "test",
        prefix="",
    )

    try:
        connector.load_credentials(credentials_dict)
        document_batch_generator = connector.load_from_state()
        for document_batch in document_batch_generator:
            print("First batch of documents:")
            for doc in document_batch:
                print(f"Document ID: {doc.id}")
                print(f"Semantic Identifier: {doc.semantic_identifier}")
                print(f"Source: {doc.source}")
                print(f"Updated At: {doc.doc_updated_at}")
                print("Sections:")
                for section in doc.sections:
                    print(f"  - Link: {section.link}")
                    if isinstance(section, TextSection) and section.text is not None:
                        print(f"  - Text: {section.text[:100]}...")
                    elif (
                        hasattr(section, "image_file_name") and section.image_file_name
                    ):
                        print(f"  - Image: {section.image_file_name}")
                    else:
                        print("Error: Unknown section type")
                print("---")
            break

    except ConnectorMissingCredentialError as e:
        print(f"Error: {e}")
    except Exception as e:
        print(f"An unexpected error occurred: {e}")
