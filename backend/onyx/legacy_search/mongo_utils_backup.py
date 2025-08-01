# import pymongo # type: ignore
# import os
# from dotenv import load_dotenv # type: ignore
# import regex as re # type: ignore
# import pandas as pd # type: ignore
# load_dotenv()

# def connect_mongo():
#     client = pymongo.MongoClient(os.environ.get("CONNECTION_URL"))
#     db = client["TechPeek"]
#     collection = db["LegalSearch"]
#     collection.create_index([("all_text", "text")])
    
#     return collection

# def insert_data(filepath):  
#     collection = connect_mongo()
#     data = pd.read_csv(filepath, usecols=['case title', 'judges name(s)', 'date of judgment', 'all_text'])
#     data_dict = data.to_dict("records")
#     collection.insert_many(data_dict)
#     print("Data inserted successfully")


# def exact_query_data(query):
#     collection = connect_mongo()
#     data = collection.find_one(query)
#     return data

# def text_search(search_text):
#     collection = connect_mongo()
#     res = list(collection.find({"$text": {"$search": search_text}}).limit(100))
#     res.sort(key=lambda doc: doc["all_text"].count(search_text), reverse=True)
#     return res

# def base_search(query):
#     res = text_search(query)
#     return res

# def refined_search(res, keyword):
#     docs = []
#     for doc in res:
#         text = doc["all_text"]
#         if re.search(rf"\b{re.escape(keyword)}\b", text, re.IGNORECASE):
#             docs.append(doc)
#     return docs

# if __name__ == "__main__":
#     print("Inserting CSV data...")
#     insert_data("fixedddd.csv")