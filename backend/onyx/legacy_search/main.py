from fastapi import APIRouter, Query, Depends # type: ignore
from typing import List, Optional
from onyx.legacy_search.mongo_utils import base_search, refined_search
from pydantic import BaseModel # type: ignore
from onyx.auth.users import current_user
import datetime as dt
import re

router = APIRouter(prefix="/legacysearch", tags=["Legacy Search"])

# ==== Models ====

class RefineRequest(BaseModel): # Will be used for refine search
    results: List[dict]
    keyword: str

class FilterRequest(BaseModel): # Will be used for advanced filter search
    results: List[dict]
    judge_name: Optional[str] = None
    case_title: Optional[str] = None
    start_date: Optional[dt.date] = None
    end_date: Optional[dt.date] = None

# ==== Endpoints ====

@router.get("/search")
def search(query: str, user=Depends(current_user)):
    raw_results = base_search(query)
    normalized = [normalize_document(doc) for doc in raw_results]
    return {"results": normalized}

@router.post("/refine_search")
def refine(request: RefineRequest, user=Depends(current_user)):
    refined = refined_search(request.results, request.keyword)
    return {"results": refined}

@router.post("/advanced_filter")
def filter_results(request: FilterRequest, user=Depends(current_user)):
    results = request.results
    if request.judge_name:
        results = filter_by_judge(results, request.judge_name)
    if request.case_title:
        results = filter_by_case_title(results, request.case_title)
    if request.start_date and request.end_date:
        results = filter_by_date(results, request.start_date, request.end_date)
    return {"results": results}

# ==== Internal Utilities ====

def normalize_document(doc):
    return {
        "case_title": doc.get("case title") or doc.get("doc_title"),
        "judges_name": doc.get("judges name(s)") or doc.get("doc_bench"),
        "date_of_judgment": doc.get("date of judgment") or doc.get("doc_date"),
        "all_text": doc.get("all_text")
    }

def filter_by_judge(res, judge_names):
    filtered_results = []
    normalized_judge_names = judge_names.strip().lower()
    for doc in res:
        doc_judge_name = doc.get("judges_name", "")
        if isinstance(doc_judge_name, str) and re.search(re.escape(normalized_judge_names), doc_judge_name.strip().lower()):
            filtered_results.append(doc)
    return filtered_results

def filter_by_case_title(res, case_title):
    filtered_results = []
    normalized_case_title = case_title.strip().lower()
    for doc in res:
        doc_title = doc["case_title"].strip().lower()
        if re.search(re.escape(normalized_case_title), doc_title):
            filtered_results.append(doc)
    return filtered_results

def filter_by_date(res, start_date, end_date):
    filtered_results = []
    for doc in res:
        try:
            date = dt.datetime.strptime(doc["date_of_judgment"], "%d %B, %Y").date()
            if start_date <= date <= end_date: # This will check whether the date is within range or not
                filtered_results.append(doc)
        except Exception:
            continue
    return filtered_results
