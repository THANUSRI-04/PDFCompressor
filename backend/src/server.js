const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { compressPDF } = require('./pdf-compressor');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const archiver = require('archiver');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({
    exposedHeaders: ['X-Compression-Results']
}));
app.use(express.json());

// Serve frontend static files
const frontendDistPath = path.join(__dirname, '../../frontend/dist');
app.use(express.static(frontendDistPath));

const uploadDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        cb(null, `${uuidv4()}-${file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_')}`);
    }
});

const upload = multer({ 
    storage,
    limits: { fileSize: 100 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'application/pdf') {
            cb(null, true);
        } else {
            cb(new Error('Only PDFs are allowed.'));
        }
    }
});

app.post('/api/compress', upload.array('pdfs', 20), async (req, res) => {
    if (!req.files || req.files.length === 0) {
        return res.status(400).json({ error: 'No files uploaded.' });
    }

    const { level } = req.body;
    let compressionSetting = '/ebook';
    if (level === 'high') compressionSetting = '/screen';
    if (level === 'low') compressionSetting = '/printer';

    try {
        const compressedFiles = [];

        for (const file of req.files) {
            const inputPath = file.path;
            const outputPath = path.join(uploadDir, `compressed_${file.filename}`);
            
            await compressPDF(inputPath, outputPath, compressionSetting);
            
            const stats = fs.statSync(outputPath);
            compressedFiles.push({
                originalName: file.originalname,
                originalSize: file.size,
                compressedSize: stats.size,
                path: outputPath,
                originalPath: inputPath
            });
        }

        // Expose metadata via header so client can show stats
        const resultsMetadata = compressedFiles.map(f => ({
            originalName: f.originalName,
            originalSize: f.originalSize,
            compressedSize: f.compressedSize
        }));
        res.setHeader('X-Compression-Results', JSON.stringify(resultsMetadata));

        if (compressedFiles.length === 1) {
            const fileData = compressedFiles[0];
            res.download(fileData.path, `compressed_${fileData.originalName}`, (err) => {
                cleanupFiles([fileData.path, fileData.originalPath]);
            });
        } else {
            res.attachment('compressed_pdfs.zip');
            const archive = archiver('zip', { zlib: { level: 9 } });

            archive.on('error', (err) => {
                throw err;
            });
            
            res.on('finish', () => {
                const filesToClean = [];
                compressedFiles.forEach(f => {
                    filesToClean.push(f.path);
                    filesToClean.push(f.originalPath);
                });
                cleanupFiles(filesToClean);
            });

            archive.pipe(res);

            compressedFiles.forEach(file => {
                archive.file(file.path, { name: `compressed_${file.originalName}` });
            });

            await archive.finalize();
        }

    } catch (error) {
        console.error('Compression error:', error);
        const uploadedFiles = req.files.map(f => f.path);
        cleanupFiles(uploadedFiles);
        res.status(500).json({ error: 'Failed to compress PDF.' });
    }
});

function cleanupFiles(paths) {
    paths.forEach(p => {
        if (fs.existsSync(p)) {
            try {
                fs.unlinkSync(p);
            } catch (err) {
                console.error(`Failed to delete file: ${p}`, err);
            }
        }
    });
}

// Handle API 404s explicitly so they don't fall through to the React SPA fallback
app.use('/api', (req, res) => {
    res.status(404).json({ error: `API route not found: ${req.method} ${req.url}` });
});

// Fallback for React SPA (Express 5 compatible)
app.use((req, res) => {
    res.sendFile(path.join(frontendDistPath, 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
