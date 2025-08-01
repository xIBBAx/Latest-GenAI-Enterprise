# import streamlit as st  # type: ignore
# st.set_page_config(
#     page_title="Legacy Search",  
#     layout="wide",               
#     initial_sidebar_state="auto"
# )
# from mongo_utils import base_search, refined_search
# import datetime as dt
# import re
# # from streamlit_javascript import st_javascript 

# def normalize_document(doc):
#     normalized_doc = {
#         "case_title": doc.get("case title") or doc.get("doc_title"),
#         "judges_name": doc.get("judges name(s)") or doc.get("doc_bench"),
#         "date_of_judgment": doc.get("date of judgment") or doc.get("doc_date"),
#         "all_text": doc.get("all_text")
#     }
#     return normalized_doc

# def filter_by_judge(res, judge_names):
#     filtered_results = []
#     normalized_judge_names = judge_names.strip().lower()
    
#     for doc in res:
#         doc_judge_name = doc.get("judges_name", "")
#         if isinstance(doc_judge_name, str):
#             doc_judge_name = doc_judge_name.strip().lower()
#             if re.search(re.escape(normalized_judge_names), doc_judge_name):
#                 filtered_results.append(doc)
    
#     return filtered_results


# def filter_by_date(res, start_date, end_date):
#     filtered_results = []
#     for doc in res:
#         date = dt.datetime.strptime(doc["date_of_judgment"], "%d %B, %Y").date()
#         if start_date <= date <= end_date:
#             filtered_results.append(doc)
#     return filtered_results

# def filter_by_case_title(res, case_title):
#     filtered_results = []
#     normalized_case_title = case_title.strip().lower()
    
#     for doc in res:
#         doc_title = doc["case_title"].strip().lower()
        
#         if re.search(re.escape(normalized_case_title), doc_title):
#             filtered_results.append(doc)
    
#     return filtered_results

# if "res" not in st.session_state:
#     st.session_state.res = []

# if "page" not in st.session_state:
#     st.session_state.page = 1
    

# if st.button("Return to Chat"):
#     js = """
#     <script>
#         window.open("http://13.202.205.217/chat", "_blank");
#     </script>
#     """
#     st.components.v1.html(js, height=0)

# st.title("Legal Case Search Service")

# query = st.text_input("Enter your search query")

# if st.button("Search"):
#     raw_results = base_search(query)
#     # Normalize the results
#     st.session_state.res = [normalize_document(doc) for doc in raw_results]

# with st.expander("Refine Search"):
#     refine_query = st.text_input("Enter a keyword to refine search")
#     if st.button("Refine Search"):
#         st.session_state.res = refined_search(st.session_state.res, refine_query)
#         st.session_state.page = 1

# if st.session_state.res or st.session_state.res == []:  
#     with st.expander("Advanced Filters"):
#         judge_name = st.text_input("Enter the judge's name")
#         if st.button("Filter by Judge"):
#             st.session_state.res = filter_by_judge(st.session_state.res, judge_name)
#             st.session_state.page = 1

#         minDate = dt.date(1970, 1, 1)
#         maxDate = dt.date.today()
        
#         start_date = st.date_input("Select start date", min_value=minDate, max_value=maxDate)
#         end_date = st.date_input("Select end date", min_value=minDate, max_value=maxDate)

#         if st.button("Filter by Date"):
#             st.session_state.res = filter_by_date(st.session_state.res, start_date, end_date)
#             st.session_state.page = 1

#         case_title = st.text_input("Enter the case title")
#         if st.button("Filter by Case Title"):
#             st.session_state.res = filter_by_case_title(st.session_state.res, case_title)
#             st.session_state.page = 1
    
#     page = st.session_state.get("page", 1)
#     per_page = 10
#     start_index = (page - 1) * per_page
#     end_index = start_index + per_page

#     if len(st.session_state.res) > per_page:
#         num_pages = len(st.session_state.res) // per_page + 1
#         st.write(f"Page {page} of {num_pages}")

#         col1, col2 = st.columns([4, 1], gap="large")
#         with col1, col2:
#             if page > 1:
#                 if col1.button("Previous Page"):
#                     st.session_state.page -= 1

#             if page < num_pages:
#                 if col2.button("Next Page"):
#                     st.session_state.page += 1
   
#     for doc in st.session_state.res[start_index:end_index]:
#         st.divider()
#         container = st.container(height=400, border=True)
#         container.write(doc["case_title"])
#         container.write(doc["judges_name"])
#         container.write(doc["date_of_judgment"])
#         container.write(doc["all_text"], unsafe_allow_html=True)

#     st.divider()
# else:
#     st.write("No results found")
