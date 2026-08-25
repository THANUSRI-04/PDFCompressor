const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const { compressQueue, initWorker, getJobStatus, serverId } = require('./queue');

function startWorkerApp() {
    const app = express();
    app.use(cors());
    app.use(express.json());

    const uploadDir = path.join(__dirname, '../uploads');
    if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
    }

    // Initialize BullMQ worker
    initWorker(uploadDir);

    const storage = multer.diskStorage({
        destination: (req, file, cb) => cb(null, uploadDir),
        filename: (req, file, cb) => cb(null, `${uuidv4()}-${file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_')}`)
    });

    const upload = multer({ 
        storage,
        limits: { fileSize: parseInt(process.env.MAX_FILE_SIZE || '104857600', 10) }, // 100MB default
        fileFilter: (req, file, cb) => {
            if (file.mimetype === 'application/pdf') cb(null, true);
            else cb(new Error('Only PDFs are allowed.'));
        }
    });

    app.get('/health', async (req, res) => {
        try {
            const activeCount = await compressQueue.getActiveCount();
            const waitingCount = await compressQueue.getWaitingCount();
            res.json({
                status: 'ok',
                serverId,
                activeJobs: activeCount,
                queuedJobs: waitingCount
            });
        } catch (err) {
            res.status(500).json({ status: 'error', error: err.message });
        }
    });

    app.post('/api/compress-internal', upload.array('pdfs', 20), async (req, res) => {
        if (!req.files || req.files.length === 0) return res.status(400).json({ error: 'No files uploaded.' });

        const { level } = req.body;
        
        // Add to queue
        const job = await compressQueue.add('compress', {
            files: req.files.map(f => ({ path: f.path, originalname: f.originalname, size: f.size })),
            level
        });

        res.json({ jobId: `${serverId}:${job.id}`, status: 'queued' });
    });

    app.get('/api/jobs-internal/:localJobId', async (req, res) => {
        const { localJobId } = req.params;
        try {
            const status = await getJobStatus(localJobId);
            if (!status) return res.status(404).json({ error: 'Job not found' });
            res.json(status);
        } catch (err) {
            console.error(err);
            res.status(500).json({ error: 'Failed to fetch job status' });
        }
    });

    app.get('/api/jobs-internal/:localJobId/download/:fileIndex?', async (req, res) => {
        const { localJobId, fileIndex } = req.params;
        const status = await getJobStatus(localJobId);
        if (!status || status.state !== 'completed') {
            return res.status(400).json({ error: 'Job not completed or not found' });
        }

        const files = status.returnvalue.files;
        if (!files || files.length === 0) return res.status(404).json({ error: 'No files available' });

        const idx = fileIndex !== undefined ? parseInt(fileIndex, 10) : 0;
        const fileData = files[idx];

        if (!fileData || !fs.existsSync(fileData.path)) {
            return res.status(404).json({ error: 'File not found on server' });
        }

        res.download(fileData.path, `compressed_${fileData.originalName}`, (err) => {
            // Optional: We can delete the compressed file after download to save space
            // if (fs.existsSync(fileData.path)) fs.unlinkSync(fileData.path);
        });
    });

    const PORT = process.env.PORT || 3001;
    app.listen(PORT, () => {
        console.log(`Worker ${serverId} running on port ${PORT}`);
    });
}

module.exports = { startWorkerApp };
