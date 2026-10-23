FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY public ./public
COPY SPEC.md ./
ENV HOST=0.0.0.0 PORT=3000 RADARNEWS_DATA=/data
VOLUME /data
EXPOSE 3000
CMD ["node", "--no-warnings=ExperimentalWarning", "src/server.js"]
