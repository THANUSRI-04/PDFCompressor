const { exec } = require('child_process');
const os = require('os');

/**
 * Compresses a PDF using Ghostscript.
 * 
 * @param {string} inputPath - The path to the input PDF file.
 * @param {string} outputPath - The path where the compressed PDF will be saved.
 * @param {string} compressionSetting - Ghostscript PDFSETTINGS (e.g., /screen, /ebook, /printer)
 * @returns {Promise<void>}
 */
function compressPDF(inputPath, outputPath, compressionSetting = '/ebook') {
    return new Promise((resolve, reject) => {
        // Determine the ghostscript command based on OS
        const gsCmd = os.platform() === 'win32' ? 'gswin64c' : 'gs';

        // Command arguments for compression
        // -sDEVICE=pdfwrite: output is PDF
        // -dCompatibilityLevel=1.4: output PDF version
        // -dPDFSETTINGS: defines quality/size trade-off
        // -dNOPAUSE -dQUIET -dBATCH: run silently and don't prompt
        const args = [
            '-sDEVICE=pdfwrite',
            '-dCompatibilityLevel=1.4',
            `-dPDFSETTINGS=${compressionSetting}`,
            '-dNOPAUSE',
            '-dQUIET',
            '-dBATCH',
            `-sOutputFile="${outputPath}"`,
            `"${inputPath}"`
        ];

        const command = `${gsCmd} ${args.join(' ')}`;

        // Increase maxBuffer to 50MB to prevent crashes if Ghostscript outputs a lot of warnings
        exec(command, { maxBuffer: 1024 * 1024 * 50 }, (error, stdout, stderr) => {
            if (error) {
                console.error(`Ghostscript Error: ${stderr || error.message}`);
                reject(error);
            } else {
                resolve();
            }
        });
    });
}

module.exports = { compressPDF };
