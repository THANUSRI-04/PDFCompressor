const express = require('express');
const cors = require('cors');
const { createProxyMiddleware } = require('http-proxy-middleware');
const axios = require('axios');
const path = require('path');

function startRouterApp() {
    const app = express();
    
    // Serve frontend static files if acting as a standalone server
    const frontendDistPath = path.join(__dirname, '../../frontend/dist');
    app.use(express.static(frontendDistPath));

    app.use(cors({
        exposedHeaders: ['X-Compression-Results']
    }));

    // Collect backend URLs from environment
    const backends = [];
    for (let i = 1; i <= 10; i++) {
        const url = process.env[`BACKEND_SERVER_${i}`];
        if (url) backends.push({ url, id: `server${i}`, active: 0, queued: 0, healthy: true });
    }

    // Default for local development if no backends specified
    if (backends.length === 0) {
        // Point to the same server assuming it's running a worker on a different port, 
        // or just let it fail gracefully if no workers are configured.
        console.warn("WARNING: No BACKEND_SERVER_X environment variables found.");
    }

    // Health check polling
    setInterval(async () => {
        for (const backend of backends) {
            try {
                const res = await axios.get(`${backend.url}/health`, { timeout: 5000 });
                backend.healthy = true;
                backend.id = res.data.serverId;
                backend.active = res.data.activeJobs;
                backend.queued = res.data.queuedJobs;
            } catch (err) {
                backend.healthy = false;
            }
        }
    }, 5000);

    // Load balancing for new uploads
    app.use('/api/compress', async (req, res, next) => {
        const healthyBackends = backends.filter(b => b.healthy);
        if (healthyBackends.length === 0) {
            return res.status(503).json({ error: 'No backend servers available' });
        }

        // Least loaded
        healthyBackends.sort((a, b) => (a.active + a.queued) - (b.active + b.queued));
        const targetBackend = healthyBackends[0];

        // Fix the URL since app.use strips the prefix
        req.url = '/api/compress-internal';

        const proxy = createProxyMiddleware({
            target: targetBackend.url,
            changeOrigin: true,
            onProxyRes: function (proxyRes, req, res) {
                proxyRes.headers['Access-Control-Allow-Origin'] = '*';
            }
        });
        
        return proxy(req, res, next);
    });

    // Proxy job status requests based on jobId prefix
    app.use('/api/jobs', (req, res, next) => {
        // req.url will be something like "/server1:1" or "/server1:1/download"
        const parts = req.url.split('/');
        if (parts.length < 2) return res.status(400).json({ error: 'Invalid job ID' });
        
        const jobId = parts[1]; // server1:1
        const [serverId, localJobId] = jobId.split(':');
        
        const targetBackend = backends.find(b => b.id === serverId);
        if (!targetBackend || !targetBackend.healthy) {
            return res.status(503).json({ error: `Backend ${serverId} is unavailable` });
        }

        let targetPath = `/api/jobs-internal/${localJobId}`;
        const downloadIndex = req.url.indexOf('/download');
        if (downloadIndex !== -1) {
            targetPath += req.url.substring(downloadIndex);
        }

        req.url = targetPath;

        const proxy = createProxyMiddleware({
            target: targetBackend.url,
            changeOrigin: true,
            onProxyRes: function (proxyRes, req, res) {
                proxyRes.headers['Access-Control-Allow-Origin'] = '*';
                proxyRes.headers['Access-Control-Expose-Headers'] = 'Content-Disposition';
            }
        });

        return proxy(req, res, next);
    });

    // Health check for the router itself
    app.get('/health', (req, res) => {
        res.json({ status: 'ok', role: 'router', backends });
    });

    // Fallback for React SPA (Express 5 compatible)
    app.use((req, res) => {
        if (!req.url.startsWith('/api')) {
            res.sendFile(path.join(frontendDistPath, 'index.html'));
        } else {
            res.status(404).json({ error: 'API route not found' });
        }
    });

    const PORT = process.env.PORT || 3001;
    app.listen(PORT, () => {
        console.log(`Router API Gateway running on port ${PORT}`);
        console.log(`Configured backends:`, backends.map(b => b.url));
    });
}

module.exports = { startRouterApp };
