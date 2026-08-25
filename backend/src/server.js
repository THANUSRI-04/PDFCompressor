require('dotenv').config();

const role = process.env.ROLE;
const isLocal = process.env.NODE_ENV !== 'production' && !process.env.REDIS_URL;

if (isLocal) {
    console.log('Running in local development mode (no REDIS_URL found). Starting both Worker and Router in the same process.');
    const { startWorkerApp } = require('./worker');
    const { startRouterApp } = require('./router');
    
    // We start the worker on port 3002, and the router on port 3001
    process.env.PORT = '3002';
    startWorkerApp();
    
    setTimeout(() => {
        process.env.PORT = '3001';
        process.env.BACKEND_SERVER_1 = 'http://localhost:3002';
        startRouterApp();
    }, 1000);

} else if (role === 'worker') {
    const { startWorkerApp } = require('./worker');
    startWorkerApp();
} else {
    const { startRouterApp } = require('./router');
    startRouterApp();
}
