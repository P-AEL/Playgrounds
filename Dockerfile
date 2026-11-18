FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server ./server
COPY api ./api
COPY lib ./lib
COPY assets ./assets
COPY scripts ./scripts
COPY index.html app.js style.css config.js ./
RUN npm run build
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080
EXPOSE 8080
USER node
CMD ["npm", "start"]
