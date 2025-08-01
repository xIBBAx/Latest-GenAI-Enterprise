from fastapi import APIRouter, Request, Depends, BackgroundTasks # type: ignore
from pydantic import BaseModel # type: ignore
from typing import Any, Dict
from fastapi.responses import JSONResponse # type: ignore
from typing import Optional

from knowledge_storm import STORMWikiRunnerArguments, STORMWikiRunner, STORMWikiLMConfigs
from knowledge_storm.lm import LitellmModel
from knowledge_storm.rm import SearXNG
from onyx.auth.users import current_user # type: ignore
import os
import json
import uuid
import re

# Load from env or fallback
job_store: dict[str, dict[str, Any]] = {}
SEARXNG_URL = os.getenv("SEARXNG_URL", "http://host.docker.internal:8087")

# 1. Set up all language models using correct setter methods
lm_configs = STORMWikiLMConfigs()

conv_simulator_lm = LitellmModel(
    model="gemini/gemini-2.0-flash",
    api_key=os.getenv("LITELLM_API_KEY")
)
question_asker_lm = LitellmModel(
    model="gemini/gemini-2.0-flash",
    api_key=os.getenv("LITELLM_API_KEY")
)
outline_gen_lm = LitellmModel(
    model="gemini/gemini-2.0-flash",
    api_key=os.getenv("LITELLM_API_KEY")
)
article_gen_lm = LitellmModel(
    model="gemini/gemini-2.0-flash",
    api_key=os.getenv("LITELLM_API_KEY")
)
article_polish_lm = LitellmModel(
    model="gemini/gemini-2.0-flash",
    api_key=os.getenv("LITELLM_API_KEY")
)

# Set all LMs
lm_configs.set_conv_simulator_lm(conv_simulator_lm)
lm_configs.set_question_asker_lm(question_asker_lm)
lm_configs.set_outline_gen_lm(outline_gen_lm)
lm_configs.set_article_gen_lm(article_gen_lm)
lm_configs.set_article_polish_lm(article_polish_lm)

# 2. Runner args
engine_args = STORMWikiRunnerArguments(
    output_dir="./results/api_run",
    max_conv_turn=3,
    max_perspective=3,
    search_top_k=3,
    retrieve_top_k=5,
)

# 3. Retriever
rm = SearXNG(
    searxng_api_url=SEARXNG_URL,
    k=engine_args.search_top_k,
)

# 4. Runner
runner = STORMWikiRunner(engine_args, lm_configs, rm)

def truncate_url(url: str, max_len: int = 100) -> str:
    if len(url) <= max_len:
        return url
    return f"{url[:60]}...{url[-30:]}"


def add_inline_citation_links(article_text: str, citations: dict) -> str:
    """
    Replace all inline URLs in the article with numbered [n] citations (no anchor tags),
    and append a numbered Sources section with full URLs.
    """
    if not article_text or not citations:
        return article_text or ""

    # Strip any <a> tags that may have been injected previously
    article_text = re.sub(r"</?a\b[^>]*>", "", article_text)

    url_to_index = citations.get("url_to_unified_index", {})
    url_to_info = citations.get("url_to_info", {})

    # Sort URLs by index (as integers)
    sorted_url_entries = sorted(url_to_index.items(), key=lambda x: int(x[1]))

    # Build replacement map: raw_url -> [n]
    raw_url_to_marker = {
        url: f"[{idx}]"
        for url, idx in sorted_url_entries
    }

    # Replace all raw URLs in the article with [n]
    for raw_url, marker in raw_url_to_marker.items():
        escaped_url = re.escape(raw_url)
        article_text = re.sub(rf"(?<!href=\")(?<!\">)({escaped_url})", marker, article_text)

    # Also ensure all [n] references are plain (no leftover anchors)
    article_text = re.sub(r"<a[^>]*>\[(\d+)\]</a>", r"[\1]", article_text)

    # Append plain Sources section
    if sorted_url_entries:
        sources = "\n".join(
            f'{int(idx)}) {url_to_info[url]["url"]}'
            for url, idx in sorted_url_entries
            if url in url_to_info and "url" in url_to_info[url]
        )
        article_text += f"\n\n---\n\n**Sources:**\n\n{sources}"

    return article_text

# IMPORTANT

# def add_inline_citation_links(article_text: str, citations: dict) -> str:
#     """
#     Replace [n] with the actual clickable URL if available,
#     and wrap any remaining raw URLs in <a> tags.
#     Removes all numbered references like [1], [2], etc.
#     """
#     if not article_text or not citations:
#         return article_text or ""

#     # Strip any pre-existing <a> tags cleanly
#     article_text = re.sub(r"</?a\b[^>]*>", "", article_text)

#     # Build index → URL mapping
#     index_to_url = {
#         int(idx): url
#         for url, idx in citations.get("url_to_unified_index", {}).items()
#     }

#     # Replace [n] with <a href="url">url</a>
#     def replace_with_link(match: re.Match[str]) -> str:
#         idx = int(match.group(1))
#         url = index_to_url.get(idx)
#         return f'<a href="{url}" target="_blank">{url}</a>' if url else ""

#     article_text = re.sub(r"\[(\d+)\]", replace_with_link, article_text)

#     # Wrap any remaining raw URLs in <a> tags (in case some were in text directly)
#     article_text = re.sub(
#         r'(?<!href=")(?<!">)(https?://[^\s<>"\']+)',
#         r'<a href="\1" target="_blank">\1</a>',
#         article_text,
#     )

#     return article_text

# def add_inline_citation_links(article_text: str, citations: dict) -> str:
#     """
#     Replaces [1], [2], ... in the article with HTML anchor tags linking to URLs.
#     """
#     if not article_text or not citations:
#         return article_text or ""

#     # Build index-to-url mapping
#     citation_dict = {}
#     for url, index in citations.get("url_to_unified_index", {}).items():
#         citation_dict[index] = citations["url_to_info"][url]["url"]

#     def replace_with_link(match):
#         idx = int(match.group(1))
#         url = citation_dict.get(idx, "#")
#         return f'<a href="{url}" target="_blank">[{idx}]</a> '

#     # Add space after each injected link to prevent clumping
#     return re.sub(r"\[(\d+)\]", replace_with_link, article_text)

# 5. Endpoint logic
def run_deepsearch(query: str) -> dict:
    try:
        runner.run(topic=query)
        topic_name = query.replace(" ", "_")
        topic_dir = os.path.join(engine_args.output_dir, topic_name)

        def safe_read(path, is_json=False):
            if os.path.exists(path):
                with open(path, "r", encoding="utf-8") as f:
                    return json.load(f) if is_json else f.read()
            return None if is_json else ""

        article_path = os.path.join(topic_dir, "storm_gen_article_polished.txt")
        citations_path = os.path.join(topic_dir, "url_to_info.json")
        conversation_log_path = os.path.join(topic_dir, "conversation_log.json")
        outline_path = os.path.join(topic_dir, "storm_gen_outline.txt")

        article_text = safe_read(article_path)
        citations = safe_read(citations_path, is_json=True)
        article_with_links = add_inline_citation_links(article_text, citations)

        return {
            "article": article_with_links,
            "outline": safe_read(outline_path),
            "citations": citations,
            "conversation_log": safe_read(conversation_log_path, is_json=True),
        }

    except Exception as e:
        return {"error": str(e)}
    
def background_deepsearch(query: str, job_id: str):
    try:
        result = run_deepsearch(query)
        job_store[job_id] = {"status": "completed", "result": result}
    except Exception as e:
        job_store[job_id] = {"status": "error", "error": str(e)}
    
class DeepSearchRequest(BaseModel):
    query: str

router = APIRouter(prefix="/deepsearch", tags=["DeepSearch"])

# @router.post("/")
# async def deepsearch_handler(request: DeepSearchRequest, user=Depends(current_user)):
#     return run_deepsearch(request.query)

@router.post("/submit")
async def submit_deepsearch_job(request: DeepSearchRequest, background_tasks: BackgroundTasks, user=Depends(current_user)):
    job_id = str(uuid.uuid4())
    job_store[job_id] = {"status": "pending"}
    background_tasks.add_task(background_deepsearch, request.query, job_id)
    return {"job_id": job_id}

@router.get("/status/{job_id}")
async def get_deepsearch_job_status(job_id: str, user=Depends(current_user)):
    job = job_store.get(job_id)
    if not job:
        return JSONResponse(status_code=404, content={"error": "Job not found"})

    if job["status"] == "completed":
        return {"status": "completed", "result": job["result"]}
    elif job["status"] == "error":
        return {"status": "error", "error": job["error"]}
    else:
        return {"status": "pending"}
