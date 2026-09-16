FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
ARG NEXT_PUBLIC_FIREBASE_API_KEY
ARG NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
ARG NEXT_PUBLIC_FIREBASE_PROJECT_ID
ENV NEXT_PUBLIC_FIREBASE_API_KEY=$NEXT_PUBLIC_FIREBASE_API_KEY
ENV NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=$NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
ENV NEXT_PUBLIC_FIREBASE_PROJECT_ID=$NEXT_PUBLIC_FIREBASE_PROJECT_ID
RUN npm run build
FROM node:22-bookworm-slim AS runner
WORKDIR /app
COPY --from=ghcr.io/astral-sh/uv:0.9.21 /uv /uvx /bin/
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
ENV UV_PYTHON_INSTALL_DIR=/opt/python
RUN git clone --no-checkout --filter=blob:none https://github.com/NousResearch/hermes-agent.git /opt/hermes \
    && git -C /opt/hermes checkout --detach 3c3ab69abb9b08683b5eb15b4e2b8be1198c875f \
    && uv venv --python 3.13 /opt/hermes/.venv \
    && uv pip install --python /opt/hermes/.venv/bin/python '/opt/hermes[mcp]' \
    && rm -rf /opt/hermes/.git
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=8080
ENV HERMES_BIN=/opt/hermes/.venv/bin/hermes AGENT_ENGINE=hermes AGENT_PROVIDER=gemini
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/scripts/worker.mjs ./scripts/worker.mjs
COPY --from=build --chown=node:node /app/.claude/skills ./.claude/skills
USER node
EXPOSE 8080
CMD ["node", "server.js"]
