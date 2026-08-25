const { exec } = require('child_process');
const os = require('os');
const fs = require('fs');

/**
 * Compresses a PDF using Ghostscript.
 * 
 * @param {string} inputPath - Path to the input PDF file.
 * @param {string} outputPath - Path where compressed PDF will be saved.
 * @param {string} compressionSetting - Ghostscript PDFSETTINGS (/screen, /ebook, /printer, /prepress)
 * @returns {Promise<void>}
 */
function compressPDF(inputPath, outputPath, compressionSetting = '/ebook') {
    return new Promise((resolve, reject) => {
        // Determine ghostscript command based on OS and availability
        const isWin = os.platform() === 'win32';
        const gsCmd = isWin ? 'gswin64c' : 'gs';

        // High-performance Ghostscript flags
        const args = [
            '-sDEVICE=pdfwrite',
            '-dCompatibilityLevel=1.4',
            `-dPDFSETTINGS=${compressionSetting}`,
            '-dColorImageDownsampleType=/Bicubic',
            '-dGrayImageDownsampleType=/Bicubic',
            '-dMonoImageDownsampleType=/Bicubic',
            '-dNumRenderingThreads=4',
            '-dNOPAUSE',
            '-dQUIET',
            '-dBATCH',
            `-sOutputFile="${outputPath}"`,
            `"${inputPath}"`
        ];

        const command = `${gsCmd} ${args.join(' ')}`;

        exec(command, { maxBuffer: 1024 * 1024 * 50 }, (error, stdout, stderr) => {
            if (error) {
                // If gswin64c fails on windows, try 'gswin32c' or 'gs'
                if (isWin && gsCmd === 'gswin64c') {
                    const fallbackCmd = `gs ${args.join(' ')}`;
                    exec(fallbackCmd, { maxBuffer: 1024 * 1024 * 50 }, (fbErr, fbStdout, fbStderr) => {
                        if (fbErr) {
                            console.error(`Ghostscript error: ${fbStderr || fbErr.message}`);
                            reject(fbErr);
                        } else {
                            resolve();
                        }
                    });
                    return;
                }
                console.error(`Ghostscript error: ${stderr || error.message}`);
                reject(error);
            } else {
                resolve();
            }
        });
    });
}

module.exports = { compressPDF };
