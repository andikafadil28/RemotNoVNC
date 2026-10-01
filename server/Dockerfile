FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --include=dev

COPY src ./src
COPY tsconfig.json ./
RUN mkdir -p /app/data

EXPOSE 3000

CMD ["npm", "run", "start"]
