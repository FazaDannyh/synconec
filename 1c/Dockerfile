# Production image
FROM node:18-alpine

# Create app directory
WORKDIR /app

# Install dependencies first (better cache)
COPY package*.json ./
RUN npm ci --omit=dev

# Copy source
COPY . .

# Environment
ENV NODE_ENV=production
ENV PORT=3000

# Expose port
EXPOSE 3000

# Start
CMD ["node", "server.js"]
