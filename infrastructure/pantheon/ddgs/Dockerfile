FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PORT=4479
RUN pip install --no-cache-dir "ddgs[api]==9.16.0"
COPY serve.py /app/serve.py
EXPOSE 4479
CMD ["python", "/app/serve.py"]
