# The API as one bundled file on a slim Node image. Builds for whatever the host
# is, so the same file serves the Mac and the ARM VPS.
FROM node:22-slim AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY contract ./contract
COPY api ./api
RUN npx esbuild api/main.ts --bundle --platform=node --format=esm --target=node22 \
      --external:pg-native --outfile=dist-api/main.mjs \
      --banner:js="import { createRequire } from 'module'; const require = createRequire(import.meta.url);"

FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /src/dist-api/main.mjs ./main.mjs
USER node
EXPOSE 8787
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:8787/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "main.mjs"]
