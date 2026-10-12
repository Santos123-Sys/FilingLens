FROM node:24-bookworm-slim AS build

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-pip python3-venv ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY requirements-yahoo.txt ./
RUN python3 -m venv /opt/yfinance-venv \
  && /opt/yfinance-venv/bin/pip install --no-cache-dir -r requirements-yahoo.txt
COPY . .
RUN npm run check && npm run build

ENV NODE_ENV=production
ENV PYTHON_EXECUTABLE=/opt/yfinance-venv/bin/python
EXPOSE 8080
CMD ["npm", "run", "start"]
