# Built from the REPOSITORY ROOT (docker compose and .github/workflows/publish.yml set the context):
# the API imports ../shared (wire types and constants it shares with the frontend), which lives outside api/.
#   docker build -f api/Dockerfile .
FROM node:22-alpine
WORKDIR /app/api
COPY api/package.json api/package-lock.json* ./
RUN npm install --omit=dev && npm cache clean --force
COPY shared/ /app/shared/
COPY api/ ./
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "server.ts"]
