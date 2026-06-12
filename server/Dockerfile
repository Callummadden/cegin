FROM node:24-alpine

WORKDIR /app

# Build tools in case better-sqlite3 has no prebuilt binary for this platform
RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN npm ci --omit=dev && apk del python3 make g++

COPY db.js index.js ./

ENV DB_PATH=/data/recipes.db
RUN mkdir -p /data && chown node:node /data
VOLUME /data

USER node
EXPOSE 3000
CMD ["node", "index.js"]
