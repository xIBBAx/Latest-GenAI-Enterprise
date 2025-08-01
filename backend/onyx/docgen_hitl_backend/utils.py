import regex as re # type: ignore
import json

def clean_output(model_output):
    """
    Cleans the model output by removing specific patterns related to section titles, content, and summaries.
    """
    output = model_output

    # Improved regex patterns for flexibility
    section_title_pattern = r'^.*Section Title:\s*'
    section_content_pattern = r'^.*Section Content:\s*'
    summary_pattern = r'^.*Summary:.*$'

    # Remove unwanted patterns
    output = re.sub(summary_pattern, '', output, flags=re.MULTILINE)
    output = re.sub(section_content_pattern, '', output, flags=re.MULTILINE)
    output = re.sub(section_title_pattern, '', output, flags=re.MULTILINE)

    return output

def get_summary(prompt):
    """
    Extracts summaries from the provided text.
    """
    summary_pattern = r'^.*Summary:\s+(.+)'
    summaries = re.findall(summary_pattern, prompt, re.MULTILINE)
    if not summaries:
        return ["No summary found"]
    return summaries


def get_titles(query):
    """
    Extracts titles from the provided text, removes duplicates, normalizes repetitive patterns,
    and cleans special characters.
    """
    # Match both "Section Title: Title" and numbered titles like "1. Title"
    pattern = r'(?:^\d+\.\s*Section Title:\s*|^\d+\.\s*)(.+)'
    raw_titles = re.findall(pattern, query, re.MULTILINE)

    # Normalize titles by removing redundant prefixes and cleaning whitespace
    cleaned_titles = [title.strip() for title in raw_titles]

    # Remove duplicates while preserving order
    unique_titles = list(dict.fromkeys(cleaned_titles))

    # Add numbering to titles
    # numbered_titles = [f"{i + 1}. {title}" for i, title in enumerate(unique_titles)]

    # print(f"Extracted and Numbered Titles: {numbered_titles}")  # Debugging
    # return numbered_titles
    
    print(f"Extracted Titles: {unique_titles}")
    return unique_titles





