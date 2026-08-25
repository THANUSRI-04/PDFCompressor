import React, { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { UploadCloud, File as FileIcon, X, CheckCircle, Settings, Download, Loader2, ArrowRight } from 'lucide-react';
import axios from 'axios';

function App() {
  const [files, setFiles] = useState([]);
  const [compressionPercent, setCompressionPercent] = useState(50);
  const [isCompressing, setIsCompressing] = useState(false);
  const [results, setResults] = useState(null);
  const [error, setError] = useState(null);

  const onDrop = useCallback((acceptedFiles) => {
    // Only accept PDFs, dropzone handles this partially, but let's be sure
    const pdfFiles = acceptedFiles.filter(f => f.type === 'application/pdf');
    if (pdfFiles.length < acceptedFiles.length) {
      setError('Only PDF files are allowed.');
    } else {
      setError(null);
    }
    
    setFiles(prev => [...prev, ...pdfFiles].map(f => Object.assign(f, {
      preview: URL.createObjectURL(f)
    })));
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'application/pdf': ['.pdf'] }
  });

  const removeFile = (fileToRemove) => {
    setFiles(files.filter(file => file !== fileToRemove));
  };

  const handleCompress = async () => {
    if (files.length === 0) return;

    setIsCompressing(true);
    setError(null);

    const formData = new FormData();
    files.forEach(file => {
      formData.append('pdfs', file);
    });
    formData.append('level', compressionPercent.toString());

    try {
      const response = await axios.post('/api/compress', formData, {
        responseType: 'blob', // To handle file download
      });

      // Try to get metadata from headers
      const resultsHeader = response.headers['x-compression-results'];
      let metadata = [];
      if (resultsHeader) {
         metadata = JSON.parse(resultsHeader);
      } else {
         // Fallback if header is missing
         metadata = files.map(f => ({
            originalName: f.name,
            originalSize: f.size,
            compressedSize: response.data.size
         }));
      }

      setResults({
        metadata,
        blob: response.data,
        isZip: files.length > 1
      });

    } catch (err) {
      console.error(err);
      setError('An error occurred during compression. Please try again.');
    } finally {
      setIsCompressing(false);
    }
  };

  const handleDownload = () => {
    if (!results) return;
    
    const url = window.URL.createObjectURL(new Blob([results.blob]));
    const link = document.createElement('a');
    link.href = url;
    
    if (results.isZip) {
      link.setAttribute('download', 'compressed_pdfs.zip');
    } else {
      link.setAttribute('download', `compressed_${results.metadata[0].originalName}`);
    }
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const reset = () => {
    setFiles([]);
    setResults(null);
    setError(null);
    setCompressionPercent(50);
  };

  const formatSize = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const calculateReduction = (orig, comp) => {
    if (!orig || !comp) return 0;
    const reduction = ((orig - comp) / orig) * 100;
    return reduction > 0 ? reduction.toFixed(1) : 0;
  };

  const totalOriginalSize = files.reduce((acc, file) => acc + file.size, 0);
  const estimatedReduction = Math.round(compressionPercent * 0.85);
  const estimatedCompressedSize = totalOriginalSize * (1 - estimatedReduction / 100);

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col font-sans">
      {/* Navbar */}
      <header className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <div className="bg-blue-600 p-2 rounded-lg">
              <FileIcon className="text-white h-6 w-6" />
            </div>
            <span className="text-xl font-bold text-gray-900 tracking-tight">PDFCompressor</span>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-grow w-full max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="text-center mb-10">
          <h1 className="text-4xl md:text-5xl font-extrabold text-gray-900 mb-4 tracking-tight">
            Compress PDF
          </h1>
          <p className="text-lg text-gray-600 max-w-2xl mx-auto">
            Reduce PDF file size without compromising quality. Fast, secure, and right in your browser.
          </p>
        </div>

        <div className="bg-white rounded-3xl shadow-xl overflow-hidden border border-gray-100 transition-all">
          {/* Top Tabs (Visual only) */}
          <div className="flex border-b border-gray-100 bg-gray-50/50">
            <div className="px-6 py-4 border-b-2 border-blue-600 text-blue-600 font-medium flex items-center">
              <UploadCloud className="w-4 h-4 mr-2" />
              Upload & Compress
            </div>
          </div>

          <div className="p-8">
            {error && (
              <div className="mb-6 p-4 bg-red-50 text-red-700 rounded-xl flex items-start border border-red-100">
                <X className="w-5 h-5 mr-3 mt-0.5 flex-shrink-0" />
                <p>{error}</p>
              </div>
            )}

            {!results ? (
              <>
                {/* Upload Area */}
                <div 
                  {...getRootProps()} 
                  className={`border-3 border-dashed rounded-2xl p-12 text-center cursor-pointer transition-all duration-200 ${
                    isDragActive 
                      ? 'border-blue-500 bg-blue-50' 
                      : 'border-gray-300 hover:border-blue-400 hover:bg-gray-50'
                  }`}
                >
                  <input {...getInputProps()} />
                  <div className="flex justify-center mb-4">
                    <div className="bg-blue-100 p-4 rounded-full text-blue-600">
                      <UploadCloud className="w-10 h-10" />
                    </div>
                  </div>
                  <h3 className="text-xl font-semibold text-gray-900 mb-2">
                    {isDragActive ? 'Drop your PDFs here' : 'Choose PDF files'}
                  </h3>
                  <p className="text-gray-500 mb-6">or drag and drop them here</p>
                  <button className="bg-blue-600 hover:bg-blue-700 text-white font-medium py-2.5 px-6 rounded-xl transition-colors shadow-sm shadow-blue-200">
                    Browse Files
                  </button>
                </div>

                {/* File List */}
                {files.length > 0 && (
                  <div className="mt-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                    <h4 className="text-sm font-semibold text-gray-900 uppercase tracking-wider mb-4">
                      Files to compress ({files.length})
                    </h4>
                    <div className="space-y-3">
                      {files.map((file, index) => (
                        <div key={index} className="flex items-center justify-between p-4 bg-gray-50 rounded-xl border border-gray-100">
                          <div className="flex items-center space-x-3 overflow-hidden">
                            <FileIcon className="text-red-500 w-8 h-8 flex-shrink-0" />
                            <div className="truncate">
                              <p className="text-sm font-medium text-gray-900 truncate">{file.name}</p>
                              <p className="text-xs text-gray-500">{formatSize(file.size)}</p>
                            </div>
                          </div>
                          <button 
                            onClick={(e) => { e.stopPropagation(); removeFile(file); }}
                            className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                          >
                            <X className="w-5 h-5" />
                          </button>
                        </div>
                      ))}
                    </div>

                    {/* Compression Options */}
                    <div className="mt-8">
                      <h4 className="text-sm font-semibold text-gray-900 uppercase tracking-wider mb-4 flex items-center">
                        <Settings className="w-4 h-4 mr-2" />
                        Compression Level
                      </h4>
                      <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
                        <div className="flex justify-between items-center mb-4">
                          <span className="text-sm font-medium text-gray-500">0%</span>
                          <span className="text-2xl font-bold text-blue-600">{compressionPercent}%</span>
                          <span className="text-sm font-medium text-gray-500">100%</span>
                        </div>
                        <input 
                          type="range" 
                          min="0" 
                          max="100" 
                          value={compressionPercent}
                          onChange={(e) => setCompressionPercent(parseInt(e.target.value))}
                          className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600 mb-6"
                        />
                        <div className="bg-blue-50 p-4 rounded-lg border border-blue-100 flex flex-col sm:flex-row justify-between items-center text-sm">
                          <div className="mb-2 sm:mb-0">
                            <span className="text-gray-500 mr-2">Original Size:</span>
                            <span className="font-semibold text-gray-900">{formatSize(totalOriginalSize)}</span>
                          </div>
                          <div className="mb-2 sm:mb-0">
                            <span className="text-gray-500 mr-2">Estimated Output:</span>
                            <span className="font-semibold text-blue-700">
                              {totalOriginalSize < 100 * 1024 ? 'Minimal reduction' : `~${formatSize(estimatedCompressedSize)}`}
                            </span>
                          </div>
                          <div>
                            <span className="text-gray-500 mr-2">Estimated Reduction:</span>
                            <span className="font-semibold text-green-600">
                              {totalOriginalSize < 100 * 1024 ? '0%' : `~${estimatedReduction}%`}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Action Button */}
                    <div className="mt-8 pt-6 border-t border-gray-100 flex justify-end">
                      <button 
                        onClick={handleCompress}
                        disabled={isCompressing}
                        className="w-full md:w-auto bg-gray-900 hover:bg-black text-white font-medium py-3.5 px-8 rounded-xl transition-all flex items-center justify-center disabled:opacity-70 shadow-lg shadow-gray-200"
                      >
                        {isCompressing ? (
                          <>
                            <Loader2 className="animate-spin w-5 h-5 mr-3" />
                            Compressing...
                          </>
                        ) : (
                          <>
                            Compress PDF{files.length > 1 ? 's' : ''}
                            <ArrowRight className="w-5 h-5 ml-2" />
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                )}
              </>
            ) : (
              /* Results Area */
              <div className="text-center py-8 animate-in zoom-in-95 duration-500">
                <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
                  <CheckCircle className="w-10 h-10 text-green-600" />
                </div>
                <h2 className="text-2xl font-bold text-gray-900 mb-2">Compression Complete!</h2>
                <p className="text-gray-500 mb-8">Your files have been successfully compressed.</p>
                
                <div className="bg-gray-50 rounded-2xl p-6 mb-8 text-left max-w-lg mx-auto border border-gray-100">
                  <h4 className="text-sm font-semibold text-gray-900 uppercase tracking-wider mb-4 border-b border-gray-200 pb-2">Results</h4>
                  <div className="space-y-4 max-h-64 overflow-y-auto">
                    {results.metadata.map((meta, idx) => (
                      <div key={idx} className="flex flex-col bg-white p-4 rounded-xl shadow-sm border border-gray-100">
                         <div className="font-medium text-gray-900 truncate mb-2" title={meta.originalName}>
                            {meta.originalName}
                         </div>
                         <div className="grid grid-cols-3 gap-2 text-sm">
                            <div>
                               <p className="text-gray-500 text-xs">Original Size</p>
                               <p className="font-semibold text-gray-700">{formatSize(meta.originalSize)}</p>
                            </div>
                            <div>
                               <p className="text-gray-500 text-xs">Compressed</p>
                               <p className="font-semibold text-green-600">{formatSize(meta.compressedSize)}</p>
                            </div>
                            <div>
                               <p className="text-gray-500 text-xs">Reduced By</p>
                               {calculateReduction(meta.originalSize, meta.compressedSize) > 0 ? (
                                  <p className="font-semibold text-blue-600">{calculateReduction(meta.originalSize, meta.compressedSize)}%</p>
                               ) : (
                                  <p className="font-semibold text-gray-500 text-xs mt-0.5 leading-tight">No significant<br/>reduction</p>
                               )}
                            </div>
                         </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row items-center justify-center space-y-3 sm:space-y-0 sm:space-x-4">
                  <button 
                    onClick={handleDownload}
                    className="w-full sm:w-auto bg-blue-600 hover:bg-blue-700 text-white font-medium py-3.5 px-8 rounded-xl transition-all flex items-center justify-center shadow-lg shadow-blue-200"
                  >
                    <Download className="w-5 h-5 mr-2" />
                    Download {results.isZip ? 'All (ZIP)' : 'PDF'}
                  </button>
                  <button 
                    onClick={reset}
                    className="w-full sm:w-auto bg-white border-2 border-gray-200 hover:border-gray-300 hover:bg-gray-50 text-gray-700 font-medium py-3 px-8 rounded-xl transition-all"
                  >
                    Compress Another
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="bg-white border-t border-gray-200 mt-auto">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 flex flex-col md:flex-row items-center justify-between">
          <p className="text-gray-500 text-sm">
            © {new Date().getFullYear()} PDFCompressor. All rights reserved.
          </p>
          <div className="flex space-x-6 mt-4 md:mt-0">
            <a href="#" className="text-gray-400 hover:text-gray-500">Privacy Policy</a>
            <a href="#" className="text-gray-400 hover:text-gray-500">Terms of Service</a>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default App;
