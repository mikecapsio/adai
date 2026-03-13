# syntax=docker/dockerfile:1

# Match the Playwright image to the package version so PDF export has Chromium available.
FROM mcr.microsoft.com/playwright:v1.58.2-noble AS build
WORKDIR /app

ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json

RUN npm ci --include-workspace-root false --workspace backend

COPY backend backend

RUN npm run build --workspace backend

FROM mcr.microsoft.com/playwright:v1.58.2-noble AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json

RUN npm ci --omit=dev --include-workspace-root false --workspace backend

COPY --from=build /app/backend/dist backend/dist

EXPOSE 8080

CMD ["node", "backend/dist/index.js"]
