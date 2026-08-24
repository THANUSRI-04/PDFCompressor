# Build the React frontend
FROM node:20 AS frontend-builder
WORKDIR /app/frontend
# Only copy package.json (not package-lock.json) to avoid Windows->Linux native binary issues with esbuild
COPY frontend/package.json ./
# Ensure devDependencies are installed by unsetting NODE_ENV
ENV NODE_ENV=development
RUN npm install
COPY frontend/ ./
# Limit memory to prevent Out-Of-Memory (OOM) errors on free tiers during Vite build
ENV NODE_OPTIONS="--max-old-space-size=256"
RUN npm run build

# Build the Node.js backend
FROM node:20-alpine
WORKDIR /app

# Install Ghostscript and required fonts
RUN apk add --no-cache ghostscript ghostscript-fonts

# Copy backend files (ignore package-lock.json to avoid cross-platform issues)
COPY backend/package.json ./backend/
WORKDIR /app/backend
RUN npm install --production
COPY backend/ ./

# Copy the built frontend static files from the previous stage
COPY --from=frontend-builder /app/frontend/dist /app/frontend/dist

# Expose the port the backend runs on
EXPOSE 3001

# Command to run the application
CMD ["npm", "start"]
