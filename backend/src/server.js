require('dotenv').config();

const role = process.env.ROLE;
const isLocal = process.env.NODE_ENV !== 'production' && !process.env.REDIS_URL;
const originalPort = process.env.PORT || '3001';

if (isLocal || !role) {
    if (!isLocal) {
        console.log('Starting in monolith mode on Render (Worker + Router).');
    } else {
        console.log('Running in local development mode. Starting both Worker and Router.');
    }
    const { startWorkerApp } = require('./worker');
    const { startRouterApp } = require('./router');
    
    const workerPort = 3002;
    process.env.PORT = workerPort.toString();
    startWorkerApp();
    
    setTimeout(() => {
        process.env.PORT = originalPort.toString();
        process.env.BACKEND_SERVER_1 = `http://127.0.0.1:${workerPort}`;
        startRouterApp();
    }, 1000);

} else if (role === 'worker') {
    const { startWorkerApp } = require('./worker');
    startWorkerApp();
} else {
    const { startRouterApp } = require('./router');
    startRouterApp();
}
