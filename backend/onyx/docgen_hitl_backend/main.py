from fastapi import APIRouter, HTTPException, Depends  # type: ignore
from pydantic import BaseModel  # type: ignore
from onyx.docgen_hitl_backend.inference import run_inference
from chromadb.utils import embedding_functions  # type: ignore
import chromadb  # type: ignore
from chromadb.config import Settings # type: ignore
from onyx.docgen_hitl_backend.utils import clean_output, get_titles, get_summary
from fastapi.responses import StreamingResponse # type: ignore
from dotenv import load_dotenv # type: ignore
import google.generativeai as genai  # type: ignore
from onyx.auth.users import current_user # type: ignore
from typing import Dict
import asyncio
import json
import os

# Comment this out once Huggingface Inference Pro is Restored
load_dotenv()

print("[DEBUG] GEMINI_API_KEY:", os.getenv("GEMINI_API_KEY"))
print("[DEBUG] DOCGEN_HITL_FINAL_OUTPUT_PATH:", os.getenv("DOCGEN_HITL_FINAL_OUTPUT_PATH"))

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
genai.configure(api_key=GEMINI_API_KEY)

# Fetch paths from env
INIT_PROMPT_PATH = os.getenv("DOCGEN_HITL_PROMPT_PATH")
STEP_PATH = os.getenv("DOCGEN_HITL_STEP_PATH")
FINAL_OUTPUT_PATH = os.getenv("DOCGEN_HITL_FINAL_OUTPUT_PATH")
PROMPTS_PATH = os.getenv("DOCGEN_HITL_PROMPTS_PATH")
QUERIED_SUMMARIES_PATH = os.getenv("DOCGEN_HITL_QUERIED_SUMMARIES_PATH")
INIT_RESULT_PATH = os.getenv("DOCGEN_HITL_INIT_RESULT_PATH")
TITLES_PATH = os.getenv("DOCGEN_HITL_TITLES_PATH")
PROGRESS_PATH = os.getenv("DOCGEN_HITL_PROGRESS_PATH")

# Validate all required paths
required_paths = {
    "DOCGEN_HITL_PROMPT_PATH": INIT_PROMPT_PATH,
    "DOCGEN_HITL_STEP_PATH": STEP_PATH,
    "DOCGEN_HITL_FINAL_OUTPUT_PATH": FINAL_OUTPUT_PATH,
    "DOCGEN_HITL_PROMPTS_PATH": PROMPTS_PATH,
    "DOCGEN_HITL_QUERIED_SUMMARIES_PATH": QUERIED_SUMMARIES_PATH,
    "DOCGEN_HITL_INIT_RESULT_PATH": INIT_RESULT_PATH,
    "DOCGEN_HITL_TITLES_PATH": TITLES_PATH,
    "DOCGEN_HITL_PROGRESS_PATH": PROGRESS_PATH,
}

for key, path in required_paths.items():
    if not path:
        raise FileNotFoundError(f"{key} is not set in the .env file")
    if not os.path.exists(path):
        # Create empty files for dynamic ones, not templates
        if "PROMPT" not in key and "STEP" not in key:
            open(path, 'a').close()
        else:
            raise FileNotFoundError(f"Template file not found: {path}")

router = APIRouter(prefix="/docgen_hitl", tags=["DocGen_HITL"]) # Prefix docgen_hitl endpoint with /docgen_hitl

# Initialize ChromaDB and embedding function
chroma_client = chromadb.PersistentClient(path="/app/.chromadb")
embedder = embedding_functions.SentenceTransformerEmbeddingFunction("multi-qa-mpnet-base-cos-v1")
collection = chroma_client.get_or_create_collection("summaries", embedding_function=embedder)

# Pydantic models
class DocumentRequest(BaseModel):
    document_title: str
    document_info: str

class TitlesUpdateRequest(BaseModel):
    titles: list

# Utility functions
def read_file(file):
    with open(file, "r") as f:
        return f.read()

def write_file(file, data):
    with open(file, "w") as f:
        f.write(data)

# Step 1: Fetch Initial Titles
@router.post("/fetch_titles")
async def fetch_titles(request: DocumentRequest, user=Depends(current_user)):
    async def title_stream():
        try:
            # Prepare the initial prompt
            init_prompt = read_file(INIT_PROMPT_PATH).format(
                document_title=request.document_title,
                document_info=request.document_info
            )

            # Run the inference to get titles
            output = run_inference(init_prompt)
            write_file(INIT_RESULT_PATH, output)
            print(f"Raw Model Output:\n{output}")

            # Extract titles incrementally
            titles = get_titles(output)
            if not titles:
                raise ValueError("No valid titles extracted. Check the model output or input description.")

            write_file(TITLES_PATH, "\n".join(titles))  # Save titles for later use
            write_file(QUERIED_SUMMARIES_PATH, "")
            write_file(PROMPTS_PATH, "")

            for title in titles:
                await asyncio.sleep(0.1)  # Simulate delay (optional, for smoother streaming)
                yield json.dumps({"title": title}) + "\n"  # Stream each title as JSON
        except Exception as e:
            print(f"Error in fetch_titles: {str(e)}")  # Debugging log
            yield json.dumps({"error": str(e)}) + "\n"

    # Stream the titles back to the client
    return StreamingResponse(title_stream(), media_type="application/json")

# Step 2: Save Modified Titles
@router.post("/save_titles")
async def save_titles(request: TitlesUpdateRequest, user=Depends(current_user)):
    try:
        write_file(TITLES_PATH, "\n".join(request.titles))
        return {"message": "Titles updated successfully"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    
# Step 3: Generate Document Sections & Content
@router.post("/docgen_hitl")
async def generate_document(request: DocumentRequest, user=Depends(current_user)):
    async def document_stream():
        try:
            # Read titles dynamically
            titles = read_file(TITLES_PATH).splitlines()
            existing_ids = collection.get()["ids"]
            if existing_ids:  # Only delete if there's something to delete
                collection.delete(ids=existing_ids)
            if not titles:
                raise ValueError("No titles found. Please ensure valid titles are saved.")

            # Prepare variables for streaming
            step_prompt = read_file(STEP_PATH)
            write_file(PROGRESS_PATH, "Initializing document generation...\n")
            write_file(QUERIED_SUMMARIES_PATH, "")
            write_file(PROMPTS_PATH, "")
            write_file(FINAL_OUTPUT_PATH, "")  # Clear at the start

            for counter, title in enumerate(titles):
                # Update progress
                progress_message = f"Generating section {counter + 1} of {len(titles)}: '{title}'. Please review the progress as it unfolds."
                write_file(PROGRESS_PATH, progress_message)

                # Query ChromaDB for summary
                summary = collection.query(query_texts=title, n_results=1)
                try:
                    queried_summary = summary["documents"][0][0]
                except (IndexError, KeyError):
                    queried_summary = "No additional information found"

                # Write queried summary to file
                with open(QUERIED_SUMMARIES_PATH, "a") as f:
                    f.write(queried_summary)
                    f.write("\n\n")

                # Generate the next prompt
                prompt = step_prompt.format(
                    document_title=request.document_title,
                    document_info=request.document_info,
                    iterating_section=title,
                    additional_information=queried_summary,
                )

                # Write prompt to file
                with open(PROMPTS_PATH, "a") as f:
                    f.write(prompt)
                    f.write("\n\n")
                    
                # Run inference and process the result
                result = run_inference(prompt)

                # Parse and summarize the result
                parsed_summary = get_summary(result)  # Parse result

                # Add parsed summary to ChromaDB collection
                if isinstance(parsed_summary, list):
                    parsed_summary = " ".join(parsed_summary)
                collection.add(f"id{counter}", documents=[parsed_summary])

                # Clean the result
                clean_result = clean_output(result)

                # Write clean result to final_output.txt
                with open(FINAL_OUTPUT_PATH, "a") as f:
                    f.write("\n\n")
                    f.write(clean_result)
                    f.write("\n\n")

                # Stream the result immediately
                yield json.dumps({
                    "title": title,
                    "content": clean_result,
                    "parsed_summary": parsed_summary,  # Include parsed_summary
                    "progress": f"Completed section {counter + 1} of {len(titles)}"
                }) + "\n"

                # Small delay to simulate processing time
                await asyncio.sleep(0.1)

            # Finalize progress
            write_file(PROGRESS_PATH, "Document generation completed.")
            yield json.dumps({"status": "Document generation completed"}) + "\n"

        except Exception as e:
            # Handle errors during streaming
            yield json.dumps({"error": str(e)}) + "\n"

    # Return a streaming response
    return StreamingResponse(document_stream(), media_type="application/json")
    
@router.get("/get_progress")
async def get_progress(user=Depends(current_user)):
    try:
        progress = read_file(PROGRESS_PATH)
        return {"status": progress.strip()}
    except FileNotFoundError:
        return {"status": "No progress yet."}

