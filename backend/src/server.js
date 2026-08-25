require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const archiver = require('archiver');
const { compressPDF } = require('./pdf-compressor');

const app = express();
const PORT = process.env.PORT || 3001;

// Helper to create zip archive across archiver versions
function createZipArchive(options) {
    if (typeof archiver === 'function') {
        return archiver('zip', options);
    }
    if (archiver.ZipArchive) {
        return new archiver.ZipArchive(options);
    }
    if (archiver.create) {
        return archiver.create('zip', options);
    }
    throw new Error('Unsupported archiver format');
}

// CORS setup
app.use(cors({
    origin: '*',
    exposedHeaders: ['Content-Disposition', 'X-Compression-Results']
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve frontend static build files if available
const frontendDistPath = path.join(__dirname, '../../frontend/dist');
if (fs.existsSync(frontendDistPath)) {
    app.use(express.static(frontendDistPath));
}

// Uploads and storage setup
const uploadDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// In-memory store for compressed files metadata
const compressedFilesStore = new Map();

// Multer configuration
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => cb(null, `raw_${uuidv4()}_${file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_')}`)
});

const upload = multer({
    storage,
    limits: { fileSize: parseInt(process.env.MAX_FILE_SIZE || '104857600', 10) }, // 100MB
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'application/pdf' || file.originalname.toLowerCase().endsWith('.pdf')) {
            cb(null, true);
        } else {
            cb(new Error('Only PDF files are allowed.'));
        }
    }
});

// Periodic cleanup of files older than 30 minutes
setInterval(() => {
    const now = Date.now();
    const maxAge = 30 * 60 * 1000; // 30 mins

    for (const [id, fileData] of compressedFilesStore.entries()) {
        if (now - fileData.createdAt > maxAge) {
            if (fs.existsSync(fileData.path)) {
                try { fs.unlinkSync(fileData.path); } catch (e) {}
            }
            compressedFilesStore.delete(id);
        }
    }

    // Also sweep orphaned files in uploads directory
    try {
        const files = fs.readdirSync(uploadDir);
        for (const file of files) {
            const filePath = path.join(uploadDir, file);
            const stats = fs.statSync(filePath);
            if (now - stats.mtimeMs > maxAge) {
                try { fs.unlinkSync(filePath); } catch (e) {}
            }
        }
    } catch (err) {
        console.error('Cleanup error:', err.message);
    }
}, 10 * 60 * 1000);

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ status: 'ok', uptime: process.uptime(), storedFiles: compressedFilesStore.size });
});

// Direct PDF Compression endpoint (Fast, no queues, no Redis)
app.post('/api/compress', upload.array('pdfs', 20), async (req, res) => {
    if (!req.files || req.files.length === 0) {
        return res.status(400).json({ error: 'No files uploaded.' });
    }

    const { level } = req.body;
    let compressionSetting = '/ebook';
    
    const numericLevel = parseInt(level, 10);
    if (!isNaN(numericLevel)) {
        if (numericLevel >= 75) compressionSetting = '/screen';
        else if (numericLevel >= 50) compressionSetting = '/ebook';
        else if (numericLevel >= 25) compressionSetting = '/printer';
        else compressionSetting = '/prepress';
    } else {
        if (level === 'high') compressionSetting = '/screen';
        else if (level === 'low') compressionSetting = '/printer';
    }

    try {
        const results = [];

        // Process files in parallel for maximum speed
        await Promise.all(req.files.map(async (file) => {
            const fileId = uuidv4();
            const inputPath = file.path;
            const outputFilename = `comp_${fileId}_${file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
            const outputPath = path.join(uploadDir, outputFilename);

            try {
                await compressPDF(inputPath, outputPath, compressionSetting);

                let stats;
                if (fs.existsSync(outputPath)) {
                    stats = fs.statSync(outputPath);
                }

                // If Ghostscript didn't reduce size or produced a larger file, keep original
                if (!stats || stats.size >= file.size) {
                    fs.copyFileSync(inputPath, outputPath);
                    stats = fs.statSync(outputPath);
                }

                const fileInfo = {
                    id: fileId,
                    originalName: file.originalname,
                    originalSize: file.size,
                    compressedSize: stats.size,
                    path: outputPath,
                    downloadUrl: `/api/download/${fileId}`,
                    createdAt: Date.now()
                };

                compressedFilesStore.set(fileId, fileInfo);

                results.push({
                    id: fileId,
                    originalName: file.originalname,
                    originalSize: file.size,
                    compressedSize: stats.size,
                    downloadUrl: `/api/download/${fileId}`
                });
            } finally {
                // Delete the raw input file immediately to free disk space
                if (fs.existsSync(inputPath)) {
                    try { fs.unlinkSync(inputPath); } catch (e) {}
                }
            }
        }));

        res.json({
            success: true,
            files: results
        });

    } catch (error) {
        console.error('Compression processing error:', error);
        // Cleanup any remaining raw files
        for (const file of req.files) {
            if (fs.existsSync(file.path)) {
                try { fs.unlinkSync(file.path); } catch (e) {}
            }
        }
        res.status(500).json({ error: 'Failed to compress PDF: ' + error.message });
    }
});

// Single file download
app.get('/api/download/:fileId', (req, res) => {
    const { fileId } = req.params;
    const fileData = compressedFilesStore.get(fileId);

    if (!fileData || !fs.existsSync(fileData.path)) {
        return res.status(404).json({ error: 'File not found or has expired.' });
    }

    res.download(fileData.path, `compressed_${fileData.originalName}`, (err) => {
        if (err) {
            console.error('Download error:', err.message);
        }
    });
});

// Bulk download as ZIP
app.get('/api/download-all', (req, res) => {
    const idsParam = req.query.ids;
    if (!idsParam) {
        return res.status(400).json({ error: 'No file IDs provided.' });
    }

    const ids = idsParam.split(',').map(id => id.trim()).filter(Boolean);
    const validFiles = ids
        .map(id => compressedFilesStore.get(id))
        .filter(f => f && fs.existsSync(f.path));

    if (validFiles.length === 0) {
        return res.status(404).json({ error: 'No valid files found for download.' });
    }

    if (validFiles.length === 1) {
        return res.download(validFiles[0].path, `compressed_${validFiles[0].originalName}`);
    }

    res.attachment('compressed_pdfs.zip');
    try {
        const archive = createZipArchive({ zlib: { level: 9 } });

        archive.on('error', (err) => {
            console.error('Archive error:', err);
            if (!res.headersSent) {
                res.status(500).send({ error: err.message });
            }
        });

        archive.pipe(res);

        for (const file of validFiles) {
            archive.file(file.path, { name: `compressed_${file.originalName}` });
        }

        archive.finalize();
    } catch (err) {
        console.error('Zip creation error:', err);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Failed to create zip archive' });
        }
    }
});

// API 404 handler
app.use('/api', (req, res) => {
    res.status(404).json({ error: `API route not found: ${req.method} ${req.url}` });
});

// SPA fallback
app.use((req, res) => {
    if (fs.existsSync(path.join(frontendDistPath, 'index.html'))) {
        res.sendFile(path.join(frontendDistPath, 'index.html'));
    } else {
        res.status(404).send('Frontend not built. Please run npm run build in frontend directory.');
    }
});

app.listen(PORT, () => {
    console.log(`PDF Compressor Server running on port ${PORT}`);
});
