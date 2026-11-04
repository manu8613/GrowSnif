FROM python:3.13-alpine
WORKDIR /app
RUN pip install --no-cache-dir paho-mqtt==2.1.0
COPY protocol.py growatt.py inverter.py haws.py panel.py main.py ./
COPY www/ ./www/
ENV PYTHONUNBUFFERED=1
CMD ["python", "main.py"]
