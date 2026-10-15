FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
COPY src ./src
COPY public ./public
COPY scripts ./scripts
ENV DATA_DIR=/data
VOLUME /data
EXPOSE 3000
CMD ["node", "src/server.js"]
