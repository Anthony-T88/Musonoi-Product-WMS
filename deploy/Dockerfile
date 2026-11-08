FROM node:24-bookworm-slim
WORKDIR /app
RUN npm install --global pnpm@11.25.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --prod --frozen-lockfile
COPY --chown=node:node . .
RUN mkdir -p /app/uploads && chown node:node /app/uploads
USER node
ENV NODE_ENV=production APP_ENV=production HOST=0.0.0.0 PORT=4174 TZ=Africa/Lubumbashi VERIFY_SOURCE_INTEGRITY=1
EXPOSE 4174
CMD ["node", "server/app.cjs"]
