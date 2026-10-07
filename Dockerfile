FROM node:22.15.0-alpine
RUN apk add --no-cache openssl

EXPOSE 3000

WORKDIR /app

ENV NODE_ENV=production

COPY package.json ./

RUN npm install --include=dev

COPY . .

RUN npm run build

CMD ["sh", "-c", "npm run setup && npm run start"]
