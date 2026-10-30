FROM python:3.13-alpine
WORKDIR /app
RUN pip install --no-cache-dir paho-mqtt==2.1.0
COPY protocol.py main.py ./
ENV PYTHONUNBUFFERED=1
CMD ["python", "main.py"]
