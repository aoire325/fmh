FROM node:22-alpine
RUN apk add --no-cache ffmpeg
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY calls.mjs voice-service.mjs ./
RUN mkdir -p /app/voice-data && chown node:node /app/voice-data
USER node
ENV NODE_ENV=production
ENV VOICE_DATA_DIR=/app/voice-data
EXPOSE 8787
CMD ["node", "calls.mjs"]
