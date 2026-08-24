# Build the React frontend
FROM node:18-alpine AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
# Ensure devDependencies are installed by unsetting NODE_ENV
ENV NODE_ENV=development
RUN npm install
COPY frontend/ ./
RUN npm run build

# Build the Node.js backend
FROM node:18-alpine
WORKDIR /app

# Install Ghostscript
RUN apk add --no-cache ghostscript

# Copy backend files
COPY backend/package*.json ./backend/
WORKDIR /app/backend
RUN npm install --production
COPY backend/ ./

# Copy the built frontend static files from the previous stage
COPY --from=frontend-builder /app/frontend/dist /app/frontend/dist

# Expose the port the backend runs on
EXPOSE 3001

# Command to run the application
CMD ["npm", "start"]
