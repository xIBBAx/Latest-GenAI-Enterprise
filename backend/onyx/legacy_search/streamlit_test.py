# import streamlit as st # type: ignore

# content1 = """
# # Page 1

# This is page 1
# """

# content2 = """
# # Page 2

# This is page 2
# """

# if "page" not in st.session_state:
#     st.session_state.page = "page1"


# def back_button():
#     st.session_state.page = "page1"


# def next_button():
#     st.session_state.page = "page2"


# cols = st.columns([1, 10])
# if st.session_state.page == "page1":
#     with cols[0].container():
#         st.html("<span class='button'></span>")
#         st.button("→", on_click=next_button)
#     cols[1].write(content1)
# else:
#     with cols[0].container():
#         st.html("<span class='button'></span>")
#         st.button("←", on_click=back_button)
#     cols[1].write(content2)


# st.html(
#     """
# <style>
# [data-testid="stVerticalBlock"]:has(.button) button {
#     border: 2px solid yellow;
#     color: yellow;
#     border-radius: 50%;
#     padding: 0;
#     width: 41px;
#     height: 41px;
#     display: flex;
#     justify-content: center;
#     align-items: center;
#     margin-top: 26px;
# }
# [data-testid="stVerticalBlock"]:has(.button) button p{
#     font-size: 2rem;
#     margin-bottom: 3px
# }
# </style>
# """
# )