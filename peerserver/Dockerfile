# Speek PeerServer — LAN signaling only
FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY server.mjs ./
ENV HOST=0.0.0.0
ENV PORT=9000
ENV PEER_PATH=/peerjs
EXPOSE 9000
CMD ["node", "server.mjs"]
