FROM debian:trixie-slim

RUN apt-get update && \
    apt-get install -y \
        python3 \
        python3-pip \
        qemu-system-x86 \
        qemu-utils \
        novnc \
        websockify \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .

RUN pip3 install --break-system-packages -r requirements.txt

COPY main.py .

CMD ["sh", "-c", "websockify 0.0.0.0:6080 127.0.0.1:5901 & exec uvicorn main:app --host 0.0.0.0 --port 8000"]
