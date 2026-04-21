FROM python:3.10-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Run dagster webserver
CMD ["dagster-webserver", "-h", "0.0.0.0", "-p", "3000"]
