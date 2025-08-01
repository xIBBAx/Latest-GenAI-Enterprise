# from fastapi import FastAPI, HTTPException
# from fastapi.middleware.cors import CORSMiddleware
# from pydantic import BaseModel
# from fastapi.encoders import jsonable_encoder
# from fastapi.responses import JSONResponse
# from sentence_transformers import SentenceTransformer
# from langchain.llms import HuggingFaceHub
# from dotenv import load_dotenv
# from sklearn.preprocessing import StandardScaler
# import numpy as np
# import logging
# logging.basicConfig(level=logging.DEBUG)
# load_dotenv()

# app = FastAPI()
# origins = ["*"]
# app.add_middleware(
#     CORSMiddleware,
#     allow_origins=origins,
#     allow_credentials=True,
#     allow_methods=["*"],
#     allow_headers=["*"],
# )

# import os

# model_dir = './backend/danswer/caseprediction/'
# print("Files in model directory:", os.listdir(model_dir))
# model = SentenceTransformer('all-MiniLM-L6-v2')
# llm_client = HuggingFaceHub(repo_id="NousResearch/Nous-Hermes-2-Mixtral-8x7B-DPO", model_kwargs={"temperature": 0.2, "max_length": 10000})

# class CaseQuery(BaseModel):
#     query: str

# class PredictionResult(BaseModel):
#     prediction: int
#     reasoning: str

# @app.post("/caseprediction", response_model=PredictionResult)
# async def case_prediction(query_data: CaseQuery):
#     try:
      
# #        query_embedding = model.encode(query_data.query)
      
# #        print("Predicting with value:", query_embedding)
# #        prediction = int((query_embedding @ np.array([1, -1])) > 0)  
# #        print("Prediction result:", prediction)
# #        label = "accepted" if prediction else "rejected"
#         query_embedding = model.encode(query_data.query)
#         logging.debug(f"Query embedding: {query_embedding}")        
        
#         prediction_vector = np.array([1, -1])  
#         prediction_score = np.dot(query_embedding, prediction_vector)  
#         prediction = int(prediction_score > 0) 
#         logging.debug(f"Prediction score: {prediction_score}")
#         logging.debug(f"Binary prediction: {prediction}")
        
#         reasoning_prompt = f"The following case was {label} based on the analysis: {query_data.query}"
#         reasoning = llm_client.generate(
#             prompts=[reasoning_prompt],
#             max_new_tokens=300,
#             temperature=0.2
#         )
#         reasoning_text = reasoning.generations[0][0].text.strip() if reasoning.generations else "No reasoning generated."
#         logging.debug(f"Reasoning text: {reasoning_text}")
#         response_content = {
#             "prediction": int(prediction),
#             "reasoning": reasoning_text
#         }

#         return jsonable_encoder(response_content)

#     except Exception as e:
#         error_message = f"An error occurred: {str(e)}"
#         return JSONResponse(status_code=500, content={"detail": error_message})
