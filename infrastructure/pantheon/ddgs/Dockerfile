FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
RUN pip install --no-cache-dir "ddgs[api]"
EXPOSE 4479
CMD ["ddgs","api","--host","0.0.0.0","--port","4479"]
