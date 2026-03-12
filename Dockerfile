FROM node:22-alpine AS client-build
WORKDIR /app/client
COPY client/package.json client/package-lock.json ./
RUN npm ci
COPY client/ .
COPY shared/ /app/shared/
RUN npm run build

FROM node:22-alpine AS server-build
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci
COPY server/ .
COPY shared/ /app/shared/
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY server/package.json server/package-lock.json /app/server/
RUN cd /app/server && npm ci --omit=dev

COPY --from=server-build /app/server/dist /app/server/dist
COPY --from=client-build /app/client/dist /app/client/dist

EXPOSE 4000
CMD ["node", "/app/server/dist/index.js"]
