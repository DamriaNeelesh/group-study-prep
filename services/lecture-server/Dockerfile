FROM node:20-alpine

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci --only=production

# Build
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Run
EXPOSE 4000
CMD ["npm", "start"]
