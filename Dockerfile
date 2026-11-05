# Imagen para publicar Sprint en un servidor (Render, Railway, Fly.io o cualquier VPS con Docker).
# docker build -t sprint . && docker run -p 3000:3000 -e PUBLIC_HOST=localhost:3000 -e GEMINI_API_KEY=... sprint
FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --no-audit --no-fund
COPY . .
# esbuild (dev) solo se usa para armar dist/; después se quita.
RUN node scripts/build.mjs && npm prune --omit=dev
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
EXPOSE 3000
USER node
CMD ["node", "server.mjs"]
