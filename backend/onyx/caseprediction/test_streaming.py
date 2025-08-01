# import requests
# import json
# import sys

# # Set up the base URL for the case prediction API
# api_url = "http://54.79.231.211:8006/caseprediction"

# # Define the query for the case prediction
# query_data = {
#     "query": "While I was getting a surgery, the surgeon negligently left a medical sponge in my abdomen and did not take it out. This caused me physical and mental distress and I had to get another surgery to get the sponge out. Do I have a claim against the hospital?"
# }

# def stream_prediction_and_reasoning(api_url, query_data):
#     """
#     Sends the query to the case prediction API and streams the response for prediction and reasoning.
#     """
#     try:
#         # Step 1: Send the query to the caseprediction API
#         response = requests.post(api_url, json=query_data, stream=True)

#         if response.status_code != 200:
#             print(f"Error: {response.status_code}, {response.text}")
#             return

#         print("Streaming prediction and reasoning...")

#         # Step 2: Stream the response token by token
#         for chunk in response.iter_lines(decode_unicode=True):
#             if chunk:
#                 print(f"Raw chunk received: {chunk}", flush=True)  # Flush to see streaming immediately
#                 # Parse the chunked data (assume it's JSON)
#                 try:
#                     data = json.loads(chunk[5:])  # Removing "data: " prefix
#                     if "prediction" in data:
#                         print(f"\nPrediction: {data['prediction']}", flush=True)
#                     if "reasoning" in data:
#                         print(f"Reasoning: {data['reasoning']}", flush=True)
#                 except json.JSONDecodeError as e:
#                     print(f"Error decoding JSON: {e}, raw data: {chunk}", flush=True)

#     except Exception as e:
#         print(f"An error occurred: {e}", flush=True)

# # Call the function to start streaming prediction and reasoning
# stream_prediction_and_reasoning(api_url, query_data)
