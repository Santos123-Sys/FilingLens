FROM node:24-bookworm-slim AS build

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run check && npm run build

ENV NODE_ENV=production
ENV PYTHON_EXECUTABLE=python3
EXPOSE 8080
CMD ["npm", "run", "start"]
