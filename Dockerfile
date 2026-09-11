FROM node:18-slim

# Install Python3 and pip
RUN apt-get update && \
    apt-get install -y python3 python3-pip python3-venv --no-install-recommends && \
    rm -rf /var/lib/apt/lists/*

# Install Python packages
RUN python3 -m pip install --break-system-packages reportlab pillow || \
    python3 -m pip install reportlab pillow

WORKDIR /app

# Install Node dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Copy app files
COPY . .

EXPOSE 5000

CMD ["node", "server.js"]
