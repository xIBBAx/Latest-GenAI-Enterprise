# import streamlit as st
# import time
# import utils  
# import inference
# from main import main_func

# st.set_page_config(page_title="DocGen", layout="wide")

# fade_in_style = """
# <style>
# .fade-in {
#     animation: fadeIn 2s;
# }
# @keyframes fadeIn {
#     from { opacity: 0; }
#     to { opacity: 1; }
# }
# </style>
# """

# st.markdown(fade_in_style, unsafe_allow_html=True)

# hide_streamlit_style = """
# <style>
# #MainMenu {visibility: hidden;}
# footer {visibility: hidden;}
# </style>
# """
# st.markdown(hide_streamlit_style, unsafe_allow_html=True)

# if 'is_generating' not in st.session_state:
#     st.session_state.is_generating = False

# st.markdown("""
# # GPLC Document Generation
# Interactive Generation of Legal Documents
# """)

# col1, col2 = st.columns([3, 2])

# with col1:
#     novel_type = st.text_input("Document Type", placeholder="Service agreement", key="1")
#     description = st.text_area("Description", key="2")

#     output_text_area = st.empty()
#     output_text = ""

# if st.button("Init Document Generation", type="primary"):
#     st.session_state.is_generating = True 

# if st.button("Stop Generation", type="secondary"):
#     st.session_state.is_generating = False  

# if st.session_state.is_generating:
#     with st.spinner("Retrieving answers, Please hold on while we complete the generation process..."):
#         with col2:
#             st.markdown("### Memory Module")
#             clauses_placeholder = st.empty()

#         all_clauses_text = ""

#         generated_clauses = set()  
#         generated_paragraphs = set()  

#         for i, (output, clauses) in enumerate(main_func(novel_type, description)):
#             if not st.session_state.is_generating:
#                 break  

#             cleaned_output = utils.clean_output(output)  
#             cleaned_clauses = [utils.clean_output(clause) for clause in clauses]

#             new_paragraphs = [p for p in cleaned_output.split('\n') if p not in generated_paragraphs]
#             spaced_paragraphs = "\n\n".join(new_paragraphs) 
#             output_text += spaced_paragraphs + "\n\n"  
#             generated_paragraphs.update(new_paragraphs)  

#             output_text_area.text_area("Written Clauses (editable)", value=output_text, height=400, key=f"written_clauses_{i}")

#             fade_js = """
#             <script>
#             var textarea = document.getElementsByTagName('textarea')[0];
#             textarea.classList.add('fade-in');
#             </script>
#             """
#             st.markdown(fade_js, unsafe_allow_html=True)

#             new_clauses = [c for c in cleaned_clauses if c not in generated_clauses]
#             all_clauses_text += "\n".join(new_clauses) + "\n"  
#             generated_clauses.update(new_clauses)  

#             clauses_placeholder.text_area("Clauses Generated (editable)", value=all_clauses_text, height=100, key=f"clauses_{i}")

#             time.sleep(0.1)  

#         st.session_state.is_generating = False 
