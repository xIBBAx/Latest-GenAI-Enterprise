# from transformers import AutoTokenizer, AutoModelForSequenceClassification
# from langchain_community.llms import HuggingFaceHub  # Updated import
# from dotenv import load_dotenv
# import torch  # Import torch for handling the model
# import os

# # Load environment variables from .env
# load_dotenv()

# # Retrieve Hugging Face API token from environment variables
# HUGGINGFACE_API_TOKEN = os.getenv("HUGGINGFACEHUB_API_TOKEN")

# MODEL_PATH = "/home/ubuntu/danswer/backend/danswer/caseprediction/"

# # Load the local tokenizer and model
# tokenizer = AutoTokenizer.from_pretrained(MODEL_PATH, local_files_only=True, use_fast=False)
# model = AutoModelForSequenceClassification.from_pretrained(MODEL_PATH, local_files_only=True)

# print("Model and tokenizer loaded successfully!")

# # Initialize HuggingFaceHub client for reasoning generation
# llm_client = HuggingFaceHub(
#     repo_id="mistralai/Mixtral-8x7B-Instruct-v0.1",
#     model_kwargs={"temperature": 0.2, "max_length": 1000},
#     huggingfacehub_api_token=HUGGINGFACE_API_TOKEN
# )

# # Define a test case query
# query = "What are the legal implications if someone is fired without notice?"

# # Tokenize the input query
# inputs = tokenizer(query, return_tensors="pt", padding=True, truncation=True, max_length=512)

# # Get prediction from the model (dummy step to check if the model is working)
# with torch.no_grad():
#     outputs = model(**inputs)
#     predictions = torch.argmax(outputs.logits, dim=-1)
#     prediction = predictions.numpy()[0]

# # Generate the label based on the prediction
# label = "accepted" if prediction == 1 else "rejected"
# print(f"Prediction: {label}")

# # Generate reasoning using HuggingFaceHub client
# reasoning_prompt = f"The case was {label} based on the analysis: {query}"
# reasoning = llm_client.generate(prompts=[reasoning_prompt], max_new_tokens=300, temperature=0.2)
# reasoning_text = reasoning.generations[0][0].text.strip() if reasoning.generations else "No reasoning generated."

# # Print reasoning
# print(f"Reasoning: {reasoning_text}")
