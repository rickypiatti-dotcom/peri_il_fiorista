FROM node:22-alpine
WORKDIR /app
COPY backend/package.json ./
RUN npm install --omit=dev
COPY backend/server.js backend/throttle.js ./
COPY db/migrations/ ./migrations/
USER node
EXPOSE 4000
CMD ["node", "server.js"]
