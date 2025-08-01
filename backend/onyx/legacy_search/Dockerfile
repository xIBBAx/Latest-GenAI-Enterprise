# Use an official Python runtime as a parent image
FROM python:3.9-slim

# Set the working directory in the container
WORKDIR /app

# Install system dependencies required to build pandas and other packages
RUN apt-get update && apt-get install -y \
    build-essential \
    gcc \
    g++ \
    libffi-dev \
    libssl-dev \
    python3-dev \
    && rm -rf /var/lib/apt/lists/*

# Copy the current directory contents into the container at /app
COPY . /app

# Install the required Python packages
RUN pip install --upgrade pip setuptools wheel
RUN pip install --no-cache-dir -r requirements.txt

# Setup Streamlit config for light theme
RUN mkdir -p ~/.streamlit && \
    echo "\
    [theme]\n\
    base = 'light'\n\
    " > ~/.streamlit/config.toml && \
    echo "\
    [server]\n\
    headless = true\n\
    enableCORS = false\n\
    port = 8501\n\
    " >> ~/.streamlit/config.toml

# Expose Streamlit port
EXPOSE 8501

# Run the streamlit app
CMD ["streamlit", "run", "app.py", "--server.port=8501", "--server.address=0.0.0.0"]
