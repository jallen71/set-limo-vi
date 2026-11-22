FROM node:22-alpine
WORKDIR /srv/fleetcommand
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY src/ ./src/
COPY persistent/ ./persistent/
COPY public/ ./public/
COPY admin/ ./admin/
USER node
EXPOSE 8788
CMD ["node","persistent/server.js"]
