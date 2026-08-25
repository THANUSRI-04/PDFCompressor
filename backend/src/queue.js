require('dotenv').config();
const { Queue, Worker } = require('bullmq');
const Redis = require('ioredis');
const { compressPDF } = require('./pdf-compressor');
const path = require('path');
const fs = require('fs');

const redisUrl = process.env.REDIS_URL;
const serverId = process.env.SERVER_ID || 'server1';
const maxConcurrentJobs = parseInt(process.env.MAX_CONCURRENT_JOBS || '4', 10);
const compressionTimeout = parseInt(process.env.COMPRESSION_TIMEOUT || '120000', 10);

const useLocalQueue = !redisUrl;
const localJobs = new Map();
let localJobCounter = 1;

let compressQueue;
let connection;
const queueName = `compress_queue_${serverId}`;

if (!useLocalQueue) {
  connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
  compressQueue = new Queue(queueName, {
    connection,
    defaultJobOptions: { removeOnComplete: true, removeOnFail: true, timeout: compressionTimeout }
  });
} else {
  compressQueue = {
    add: async (name, data) => {
      const jobId = String(localJobCounter++);
      localJobs.set(jobId, { id: jobId, state: 'waiting', progress: 0, data });
      return { id: jobId };
    },
    getActiveCount: async () => Array.from(localJobs.values()).filter(j => j.state === 'active').length,
    getWaitingCount: async () => Array.from(localJobs.values()).filter(j => j.state === 'waiting').length
  };
}

function initWorker(uploadDir) {
  const processor = async (job) => {
    const { files, level } = job.data;
    
    let compressionSetting = '/ebook';
    const numericLevel = parseInt(level, 10);
    if (!isNaN(numericLevel)) {
        if (numericLevel >= 75) compressionSetting = '/screen';
        else if (numericLevel >= 50) compressionSetting = '/ebook';
        else if (numericLevel >= 25) compressionSetting = '/printer';
        else compressionSetting = '/prepress';
    } else {
        if (level === 'high') compressionSetting = '/screen';
        if (level === 'low') compressionSetting = '/printer';
    }

    try {
      const compressedFiles = [];
      const totalFiles = files.length;
      
      for (let i = 0; i < totalFiles; i++) {
        const file = files[i];
        const inputPath = file.path;
        const outputPath = path.join(uploadDir, `compressed_${job.id}_${file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_')}`);
        
        if (job.updateProgress) await job.updateProgress(Math.floor((i / totalFiles) * 80));
        await compressPDF(inputPath, outputPath, compressionSetting);
        
        let stats = fs.statSync(outputPath);
        if (stats.size >= file.size) {
            fs.copyFileSync(inputPath, outputPath);
            stats = fs.statSync(outputPath);
        }

        compressedFiles.push({
            originalName: file.originalname,
            originalSize: file.size,
            compressedSize: stats.size,
            path: outputPath,
            originalPath: inputPath
        });
      }

      if (job.updateProgress) await job.updateProgress(90);

      const resultsMetadata = compressedFiles.map(f => ({
          originalName: f.originalName,
          originalSize: f.originalSize,
          compressedSize: f.compressedSize
      }));

      if (job.updateProgress) await job.updateProgress(100);

      return { metadata: resultsMetadata, files: compressedFiles };
    } finally {
      for (const f of files) if (fs.existsSync(f.path)) fs.unlinkSync(f.path);
    }
  };

  if (!useLocalQueue) {
    const worker = new Worker(queueName, processor, { connection, concurrency: maxConcurrentJobs });
    worker.on('completed', job => console.log(`Job ${job.id} completed.`));
    worker.on('failed', (job, err) => console.log(`Job ${job.id} failed:`, err));
    return worker;
  } else {
    setInterval(async () => {
      for (const [id, job] of localJobs.entries()) {
        if (job.state === 'waiting') {
          job.state = 'active';
          job.updateProgress = async (p) => { job.progress = p; };
          try {
            job.returnvalue = await processor(job);
            job.state = 'completed';
          } catch (err) {
            job.state = 'failed';
            job.failedReason = err.message;
          }
        }
      }
    }, 500);
    return null;
  }
}

async function getJobStatus(localJobId) {
  if (useLocalQueue) {
    const job = localJobs.get(localJobId);
    if (!job) return null;
    return {
      id: job.id,
      state: job.state,
      progress: job.progress,
      returnvalue: job.returnvalue,
      failedReason: job.failedReason
    };
  }

  const job = await compressQueue.getJob(localJobId);
  if (!job) return null;

  const state = await job.getState();
  const progress = job.progress;
  const returnvalue = job.returnvalue;
  const failedReason = job.failedReason;

  return { id: job.id, state, progress, returnvalue, failedReason };
}

module.exports = { compressQueue, initWorker, getJobStatus, serverId };
