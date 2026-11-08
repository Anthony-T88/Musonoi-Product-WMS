FROM node:24-bookworm-slim
WORKDIR /app
RUN npm install --global pnpm@11.25.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --prod --frozen-lockfile
COPY --chown=node:node server ./server
COPY --chown=node:node dist ./dist
COPY --chown=node:node db ./db
COPY --chown=node:node templates ./templates
COPY --chown=node:node deploy ./deploy
COPY --chown=node:node tests/release ./tests/release
COPY --chown=node:node scripts/start-current.cjs scripts/db.cjs scripts/production-db.cjs scripts/preproduction-db.cjs scripts/production-bootstrap.cjs scripts/maintenance-connection.cjs scripts/migration-chain.cjs scripts/verify-release.cjs scripts/run-release-tests.cjs ./scripts/
COPY --chown=node:node README.md LICENSE NOTICE .env.example .dockerignore SOURCE_MANIFEST.json AUDIT_REMEDIATION.md ./
RUN node scripts/verify-release.cjs
RUN mkdir -p /app/uploads && chown node:node /app/uploads
USER node
ENV NODE_ENV=production APP_ENV=production HOST=0.0.0.0 PORT=4174 TZ=Africa/Lubumbashi VERIFY_SOURCE_INTEGRITY=1
EXPOSE 4174
CMD ["node", "server/app.cjs"]
