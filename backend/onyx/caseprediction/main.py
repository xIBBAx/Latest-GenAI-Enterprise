from fastapi import APIRouter, HTTPException, Depends # type: ignore
from fastapi.middleware.cors import CORSMiddleware # type: ignore
from pydantic import BaseModel # type: ignore
from fastapi.encoders import jsonable_encoder # type: ignore
from fastapi.responses import JSONResponse # type: ignore
from transformers import AutoModelForSequenceClassification, AutoTokenizer, AutoConfig  # type: ignore
from dotenv import load_dotenv  # type: ignore
import torch.nn.functional as F  # type: ignore
import torch  # type: ignore
from langchain.llms import HuggingFaceHub  # type: ignore
from google.generativeai.types import GenerationConfig # type: ignore
from onyx.auth.users import current_user # type: ignore
import google.generativeai as genai # type: ignore
import logging
import os

# Load environment variables from .env
load_dotenv()

# Retrieve Hugging Face API token from environment variables

# Uncomment this once Huggingface Inference Pro is Restored
# HUGGINGFACE_API_TOKEN = os.getenv("HUGGINGFACEHUB_API_TOKEN")
# print(f"Hugging Face API Token: {HUGGINGFACE_API_TOKEN}")

# Set up Google Gemini API client by passing the API key to enable reasoning generation
# Comment this out once Huggingface Inference Pro is Restored
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
genai.configure(api_key=GEMINI_API_KEY)

# Set up logging
logging.basicConfig(level=logging.ERROR)
logger = logging.getLogger(__name__)

router = APIRouter(prefix="/caseprediction", tags=["CasePrediction"]) # Prefix caseprediction endpoint with /caseprediction

MODEL_PATH = "/app/caseprediction_model"  # Path inside container where caseprediction model files are mounted
config_file_path = os.path.join(MODEL_PATH, "config.json")
print(f"Attempting to access config file at: {config_file_path}")

if not os.path.exists(config_file_path):
    print(f"Files in {MODEL_PATH}: {os.listdir(MODEL_PATH)}")
    raise FileNotFoundError("config.json is missing in the specified MODEL_PATH!")
else:
    print("config.json exists!")

# Initialize the LLM client
# Uncomment this once Huggingface Inference Pro is Restored
# llm_client = HuggingFaceHub(repo_id="NousResearch/Nous-Hermes-2-Mixtral-8x7B-DPO", model_kwargs={"temperature": 0.2, "max_length": 10000})

try:
    # Load model configuration
    config = AutoConfig.from_pretrained(MODEL_PATH)
    
    # Load the tokenizer
    tokenizer = AutoTokenizer.from_pretrained(MODEL_PATH, config=config, local_files_only=True, use_fast=False)
    print("AutoTokenizer loaded successfully!")

    # Load the model
    model = AutoModelForSequenceClassification.from_pretrained(MODEL_PATH, config=config, local_files_only=True)
    print("AutoModelForSequenceClassification loaded successfully!")

except Exception as e:
    raise RuntimeError(f"Error loading model from {MODEL_PATH}: {str(e)}")

# Define the request body model
class CaseQuery(BaseModel):
    query: str

# Define the response model
class PredictionResult(BaseModel):
    confidence: float
    prediction: int
    reasoning: str

# Case prediction endpoint
@router.post("/", response_model=PredictionResult)
async def case_prediction(query_data: CaseQuery, user=Depends(current_user)):
    try:
        # Step 1: Tokenize the query
        inputs = tokenizer(query_data.query, return_tensors="pt", padding=True, truncation=True, max_length=512)

        # Step 2: Get prediction and confidence from model
        with torch.no_grad():
            outputs = model(**inputs)
            print(f"Raw logits: {outputs.logits}")

            # Apply softmax to get probabilities
            probabilities = F.softmax(outputs.logits, dim=-1)
            print(f"Softmax probabilities: {probabilities}")

            # Get the predicted class (0 or 1)
            predictions = torch.argmax(probabilities, dim=-1)
            prediction = predictions.numpy()[0]

            # Get confidence based on the predicted class
            confidence = probabilities[0, prediction].item() * 100  # Convert to percentage

            # If the prediction is "rejected" (class 0), adjust confidence
            # Uncomment this if logic still needs to be applied based on Reject class index
            # if prediction == 0:
            #     confidence = 100 - confidence  

        # Step 3: Generate reasoning using Hugging Face LLM
        label = "accepted" if prediction == 1 else "rejected"
        logging.debug(f"Prediction: {label}, Confidence: {confidence:.2f}%")

        reasoning_prompt = (
            f"You are an advanced legal analysis assistant specializing in the Indian legal system, tasked with assisting legal professionals in evaluating case scenarios. "
            f"The user will provide a set of facts or a preliminary document outlining a legal matter ({query_data.query}). Your role is to analyze the provided information "
            f"and deliver a comprehensive explanation supporting the models prediction that the case would be '{label}', providing detailed reasoning grounded in the following:\n\n"

            f"Applicable Legal Frameworks: Reference relevant Indian statutes regulations, and recent amendments.\n"
            f"Case Precedents: Cite authoritative judgments from the Supreme Court of India, High Courts, or other relevant tribunals. Ensure precedents are recent and contextually relevant to the facts provided.\n"
            f"Application to Facts: Explain how the legal principles and precedents apply to the specific facts or documents submitted, addressing key issues raised in the query.\n"
            f"Counterarguments: Identify potential counterarguments or defenses that could be raised by opposing parties and evaluate their validity under Indian law, explaining why they may or may not succeed.\n"
            f"Jurisdictional Context: Where relevant, consider the specific court or jurisdiction (e.g., District Court, High Court, Supreme Court, or specialized tribunals like NCLT) and any state-specific laws that may apply.\n\n"

            f"The response should be structured as follows:\n\n"
            # f"Outcome: {label.upper()}'.\n"
            f"Legal Analysis: Provide a reasoned explanation, citing specific statutes, case law (with case names and citations where possible), and their application to the facts.\n"
            f"Counterarguments: Discuss opposing arguments and their relevance or shortcomings.\n"
            f"Conclusion: Summarize the basis for the outcome and, if applicable, suggest next steps (e.g., additional evidence needed, potential appeal, or alternative legal remedies).\n"
            f"If the facts provided are ambiguous or insufficient, highlight the gaps and suggest specific clarifications needed to refine the analysis (e.g., additional details about jurisdiction, parties, or evidence). "
            f"Avoid speculation and maintain a neutral, formal tone suitable for legal professionals. Format the response clearly with headings or bullet points for readability, ensuring it is concise yet comprehensive."
            
            f"Now begin the legal analysis based on the facts provided.\n\n"
            f"Important: Do not contradict the model prediction. Focus only on legal justification for the given outcome."
        )

        # Uncomment this once Huggingface Inference Pro is Restored
        # reasoning = llm_client.generate(
        #     prompts=[reasoning_prompt],
        #     max_new_tokens=1000,
        #     temperature=0.2
        # )
        # reasoning_text = reasoning.generations[0][0].text.strip() if reasoning.generations else "No reasoning generated."
        
        # Comment this out once Huggingface Inference Pro is Restored
        gemini_model = genai.GenerativeModel(model_name="gemini-2.0-flash")
        response = gemini_model.generate_content(
            reasoning_prompt,
            generation_config=GenerationConfig(
                max_output_tokens=3000,
                temperature=0.2
            )
        )
        reasoning_text = response.text.strip() if response.text else "No reasoning generated."    
        logging.debug(f"Reasoning: {reasoning_text}")

        # Step 4: Prepare the response
        response_content = {
            "confidence": round(confidence, 2),
            "prediction": int(prediction),
            "reasoning": reasoning_text
        }

        return jsonable_encoder(response_content)

    except Exception as e:
        logger.error(f"Error processing case prediction: {str(e)}")
        return JSONResponse(status_code=500, content={"detail": str(e)})
