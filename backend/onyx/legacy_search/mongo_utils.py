import pymongo  # type: ignore
import os
from dotenv import load_dotenv  # type: ignore
import regex as re  # type: ignore
import pandas as pd  # type: ignore

load_dotenv()


def get_collection(collection_name, text_index_field):
    client = pymongo.MongoClient(os.environ.get("CONNECTION_URL"))
    db = client["TechPeek"]
    collection = db[collection_name]
    if text_index_field:
        collection.create_index([(text_index_field, "text")])
    return collection


def already_ingested(collection):
    return collection.estimated_document_count() > 0


# ---------- INSERT FUNCTIONS WITH INGESTION CHECK ----------

def insert_high_court(filepath):
    collection = get_collection("HighCourt", "all_text")
    if already_ingested(collection):
        print("High Court data already ingested. Skipping...")
        return
    df = pd.read_csv(filepath, usecols=['case title', 'judges name(s)', 'date of judgment', 'citation', 'all_text'])
    collection.insert_many(df.to_dict("records"))
    print("High Court data inserted.")


def insert_supreme_court(filepath):
    collection = get_collection("SupremeCourt", "content")
    if already_ingested(collection):
        print("Supreme Court data already ingested. Skipping...")
        return
    df = pd.read_csv(filepath, usecols=['file_name', 'judgement_by', 'case_no', 'citation', 'content'])
    collection.insert_many(df.to_dict("records"))
    print("Supreme Court data inserted.")


def insert_state_acts(filepath):
    collection = get_collection("StateActs", "Section Text")
    if already_ingested(collection):
        print("State Acts data already ingested. Skipping...")
        return
    df = pd.read_csv(filepath, usecols=['State Name', 'Name of Statute', 'Section Number', 'Section Title', 'Section Text'])
    collection.insert_many(df.to_dict("records"))
    print("State Acts data inserted.")


def insert_central_acts(filepath):
    collection = get_collection("CentralActs", "Text")
    if already_ingested(collection):
        print("Central Acts data already ingested. Skipping...")
        return
    df = pd.read_csv(filepath)
    df.columns = [col.strip() for col in df.columns]
    df = df[['Name of Statute', 'Section Number', 'Section Title', 'Text']]
    collection.insert_many(df.to_dict("records"))
    print("Central Acts data inserted.")

# ---------- SEARCH HELPERS ----------

def text_search(search_text):
    collection = get_collection("HighCourt", "all_text")
    res = list(collection.find({"$text": {"$search": search_text}}))
    res.sort(key=lambda doc: doc["all_text"].count(search_text), reverse=True)
    return res

def text_search_supreme_court(search_text):
    collection = get_collection("SupremeCourt", "content")
    res = list(collection.find({"$text": {"$search": search_text}}))
    res.sort(key=lambda doc: doc["content"].count(search_text), reverse=True)
    return res


def text_search_state_acts(search_text):
    collection = get_collection("StateActs", "Section Text")
    res = list(collection.find({"$text": {"$search": search_text}}))
    res.sort(key=lambda doc: doc["Section Text"].count(search_text), reverse=True)
    return res


def text_search_central_acts(search_text):
    collection = get_collection("CentralActs", "Text")
    res = list(collection.find({"$text": {"$search": search_text}}))
    res.sort(key=lambda doc: doc["Text"].count(search_text), reverse=True)
    return res

def base_search(query):
    return text_search(query)


def refined_search(res, keyword, field):
    docs = []
    for doc in res:
        text = doc.get(field, "")
        if re.search(rf"\b{re.escape(keyword)}\b", text, re.IGNORECASE):
            docs.append(doc)
    return docs

# ---------- Run All Insertions ----------

if __name__ == "__main__":
    insert_high_court("fixedddd.csv")
    insert_supreme_court("SC_data_chunk.csv")
    insert_state_acts("State_Acts.csv")
    insert_central_acts("Central_Acts_chunk.csv")
