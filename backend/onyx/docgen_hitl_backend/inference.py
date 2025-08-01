# from huggingface_hub import InferenceClient --> Uncomment this out once Huggingface Inference Pro is Restored
from dotenv import load_dotenv  # type: ignore
from google.generativeai.types import GenerationConfig  # type: ignore
import google.generativeai as genai  # type: ignore
import os

load_dotenv()

# Configure Gemini
# Comment this out once Huggingface Inference Pro is Restored
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
genai.configure(api_key=GEMINI_API_KEY)

# Initialize the Gemini Model
# Comment this out once Huggingface Inference Pro is Restored
gemini_model = genai.GenerativeModel(model_name="gemini-2.5-flash-lite-preview-06-17")

# Uncomment this once Huggingface Inference Pro is Restored
# def get_model():
#     """
#     Initialize the inference client for the HuggingFace model.
#     """
#     model = InferenceClient(model="meta-llama/Meta-Llama-3-70B-Instruct", token=os.environ.get("HF_TOKEN"))
#     return model


# def run_inference(prompt: str):
#     """
#     Run inference using the HuggingFace model.
#     """
#     client = get_model()
#     print(f"Running inference with prompt: {prompt}")  # Debugging input
#     output = client.text_generation(prompt=prompt, max_new_tokens=2048, temperature=0.1)
#     print(f"Model output: {output}")  # Debugging output
#     return output

# Comment this out once Huggingface Inference Pro is Restored
def run_inference(prompt: str):
    print(f"Running inference with prompt: {prompt}")  # Debugging input
    response = gemini_model.generate_content(
        prompt,
        generation_config=GenerationConfig(
            max_output_tokens=2048,
            temperature=0.2
        )
    )
    output = response.text.strip() if response.text else "No output generated."
    print(f"Model output: {output}")  # Debugging output
    return output
