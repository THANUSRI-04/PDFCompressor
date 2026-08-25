import React, { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { UploadCloud, File as FileIcon, X, CheckCircle, Settings, Download, Loader2, ArrowRight } from 'lucide-react';
import axios from 'axios';

function App() {
  const [files, setFiles] = useState([]);
  const [compressionMode, setCompressionMode] = useState('percentage'); // 'percentage' or 'target'
  const [compressionPercent, setCompressionPercent] = useState(50);
  const [targetSizeMB, setTargetSizeMB] = useState(5);
  const [isCompressing, setIsCompressing] = useState(false);
  const [results, setResults] = useState(null);
  const [error, setError] = useState(null);
  const [recompressState, setRecompressState] = useState({});

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

    const totalOrigSize = files.reduce((acc, file) => acc + file.size, 0);
    
    let finalLevel = compressionPercent;
    if (compressionMode === 'target') {
        const targetBytes = targetSizeMB * 1024 * 1024;
        const reductionNeeded = 1 - (targetBytes / totalOrigSize);
        // Map required reduction to our 0-100 scale (where 100% slider = ~85% reduction)
        const mappedPercent = Math.max(0, Math.min(100, Math.round((reductionNeeded * 100) / 0.85)));
        finalLevel = mappedPercent;
    }

    const formData = new FormData();
    files.forEach(file => {
      formData.append('pdfs', file);
    });
    formData.append('level', finalLevel.toString());

    try {
      const { data } = await axios.post('/api/compress', formData);
      const { jobId } = data;

      const pollInterval = setInterval(async () => {
        try {
          const statusRes = await axios.get(`/api/jobs/${jobId}`);
          if (statusRes.data.state === 'completed') {
            clearInterval(pollInterval);
            setResults({
              files: statusRes.data.returnvalue.metadata.map((meta, i) => ({
                ...meta,
                jobId: jobId,
                fileIndex: i,
                originalFileIndex: i
              }))
            });
            setIsCompressing(false);
          } else if (statusRes.data.state === 'failed') {
            clearInterval(pollInterval);
            setError('Compression failed: ' + (statusRes.data.failedReason || 'Unknown error'));
            setIsCompressing(false);
          }
        } catch (err) {
          clearInterval(pollInterval);
          setError('Failed to fetch job status.');
          setIsCompressing(false);
        }
      }, 2000);

    } catch (err) {
      console.error(err);
      setError('An error occurred during upload. Please try again.');
      setIsCompressing(false);
    }
  };

  const handleRecompressSubmit = async (idx) => {
    const fileResult = results.files[idx];
    const originalFile = files[fileResult.originalFileIndex];
    if (!originalFile) return;

    setRecompressState(prev => ({ ...prev, [idx]: { ...prev[idx], loading: true } }));

    const formData = new FormData();
    formData.append('pdfs', originalFile);
    formData.append('level', recompressState[idx].level.toString());

    try {
      const { data } = await axios.post('/api/compress', formData);
      const pollJobId = data.jobId;

      const pollInterval = setInterval(async () => {
        try {
          const statusRes = await axios.get(`/api/jobs/${pollJobId}`);
          if (statusRes.data.state === 'completed') {
            clearInterval(pollInterval);
            const newMeta = statusRes.data.returnvalue.metadata[0];
            
            setResults(prev => {
              const newFiles = [...prev.files];
              newFiles[idx] = {
                ...newMeta,
                jobId: pollJobId,
                fileIndex: 0,
                originalFileIndex: fileResult.originalFileIndex
              };
              return { files: newFiles };
            });
            
            setRecompressState(prev => {
              const next = { ...prev };
              delete next[idx];
              return next;
            });
          } else if (statusRes.data.state === 'failed') {
            clearInterval(pollInterval);
            setRecompressState(prev => ({ ...prev, [idx]: { ...prev[idx], loading: false, error: 'Failed' } }));
          }
        } catch (err) {
          clearInterval(pollInterval);
          setRecompressState(prev => ({ ...prev, [idx]: { ...prev[idx], loading: false, error: 'Error' } }));
        }
      }, 2000);
    } catch (err) {
      setRecompressState(prev => ({ ...prev, [idx]: { ...prev[idx], loading: false, error: 'Error' } }));
    }
  };

  const reset = () => {
    setFiles([]);
    setResults(null);
    setError(null);
    setCompressionPercent(50);
    setCompressionMode('percentage');
    setTargetSizeMB(5);
    setRecompressState({});
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
  
  let effectivePercent = compressionPercent;
  let estimatedCompressedSize = 0;
  let estimatedReduction = 0;

  if (compressionMode === 'percentage') {
      estimatedReduction = Math.round(effectivePercent * 0.85);
      estimatedCompressedSize = totalOriginalSize * (1 - estimatedReduction / 100);
  } else {
      estimatedCompressedSize = targetSizeMB * 1024 * 1024;
      if (estimatedCompressedSize > totalOriginalSize) estimatedCompressedSize = totalOriginalSize;
      estimatedReduction = totalOriginalSize > 0 ? Math.round(((totalOriginalSize - estimatedCompressedSize) / totalOriginalSize) * 100) : 0;
  }

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
                      <h4 className="text-sm font-semibold text-gray-900 uppercase tracking-wider mb-4 flex items-center justify-between">
                        <span className="flex items-center">
                           <Settings className="w-4 h-4 mr-2" />
                           Compression Mode
                        </span>
                        <div className="flex bg-gray-100 rounded-lg p-1">
                           <button 
                             onClick={() => setCompressionMode('percentage')}
                             className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${compressionMode === 'percentage' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                           >
                             Percentage
                           </button>
                           <button 
                             onClick={() => setCompressionMode('target')}
                             className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${compressionMode === 'target' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                           >
                             Target Size
                           </button>
                        </div>
                      </h4>
                      <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
                        
                        {compressionMode === 'percentage' ? (
                            <>
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
                            </>
                        ) : (
                            <div className="mb-6">
                                <label className="block text-sm font-medium text-gray-700 mb-2">Target Total Size (MB)</label>
                                <div className="flex items-center">
                                    <input 
                                      type="number"
                                      min="0.1"
                                      step="0.1"
                                      value={targetSizeMB}
                                      onChange={(e) => setTargetSizeMB(parseFloat(e.target.value) || 0)}
                                      className="w-full bg-gray-50 border border-gray-300 text-gray-900 text-lg rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-3"
                                    />
                                    <span className="ml-3 text-gray-500 font-medium">MB</span>
                                </div>
                                <p className="text-xs text-gray-400 mt-2">Note: Ghostscript cannot target exact file sizes. The server will select the closest compression preset based on your target.</p>
                            </div>
                        )}

                        <div className="bg-blue-50 p-4 rounded-lg border border-blue-100 flex flex-col sm:flex-row justify-between items-center text-sm">
                          <div className="mb-2 sm:mb-0">
                            <span className="text-gray-500 mr-2">Original Total:</span>
                            <span className="font-semibold text-gray-900">{formatSize(totalOriginalSize)}</span>
                          </div>
                          <div className="mb-2 sm:mb-0">
                            <span className="text-gray-500 mr-2">Estimated Output:</span>
                            <span className="font-semibold text-blue-700">
                              {totalOriginalSize < 100 * 1024 ? 'Minimal reduction' : `~${formatSize(estimatedCompressedSize)}`}
                            </span>
                          </div>
                          <div>
                            <span className="text-gray-500 mr-2">Est. Reduction:</span>
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
                  <div className="space-y-4 max-h-96 overflow-y-auto pr-2">
                    {results.files.map((fileResult, idx) => {
                      const savings = fileResult.originalSize > 0 
                          ? Math.max(0, Math.round(((fileResult.originalSize - fileResult.compressedSize) / fileResult.originalSize) * 100))
                          : 0;
                          
                      const isRecompressing = recompressState[idx]?.isOpen;
                      const rState = recompressState[idx];

                      return (
                      <div key={idx} className="flex flex-col bg-white p-4 rounded-xl shadow-sm border border-gray-100 transition-all">
                         <div className="flex flex-col sm:flex-row sm:items-center justify-between">
                             <div className="flex-1 mb-3 sm:mb-0">
                                 <div className="font-medium text-gray-900 truncate" title={fileResult.originalName}>
                                    {fileResult.originalName}
                                 </div>
                                 <div className="flex items-center text-sm mt-1 text-gray-500 space-x-2">
                                   <span>{(fileResult.originalSize / 1024 / 1024).toFixed(2)} MB</span>
                                   <span>→</span>
                                   <span className="font-medium text-green-600">{(fileResult.compressedSize / 1024 / 1024).toFixed(2)} MB</span>
                                   <span className="bg-green-100 text-green-700 py-0.5 px-2 rounded-full text-xs font-semibold ml-2">
                                      -{savings}%
                                   </span>
                                 </div>
                             </div>
                             
                             {!isRecompressing && (
                                 <div className="flex space-x-2">
                                    <button
                                      onClick={() => setRecompressState(prev => ({ ...prev, [idx]: { isOpen: true, level: 50, loading: false } }))}
                                      className="inline-flex items-center justify-center px-3 py-2 bg-gray-50 text-gray-700 rounded-lg hover:bg-gray-100 font-medium transition-colors text-sm border border-gray-200"
                                    >
                                      <Settings className="w-4 h-4 mr-1.5" />
                                      Retry
                                    </button>
                                    <a
                                      href={`/api/jobs/${fileResult.jobId}/download/${fileResult.fileIndex}`}
                                      download={`compressed_${fileResult.originalName}`}
                                      className="inline-flex items-center justify-center px-3 py-2 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 font-medium transition-colors text-sm"
                                    >
                                      <Download className="w-4 h-4 mr-1.5" />
                                      Download
                                    </a>
                                 </div>
                             )}
                         </div>

                         {isRecompressing && (
                             <div className="mt-4 pt-4 border-t border-gray-100 animate-in slide-in-from-top-2 duration-300">
                                <div className="flex justify-between items-center mb-2">
                                   <label className="text-xs font-medium text-gray-500 uppercase tracking-wider">New Compression Level</label>
                                   <span className="text-sm font-bold text-blue-600">{rState.level}%</span>
                                </div>
                                <input 
                                  type="range" min="0" max="100" 
                                  value={rState.level}
                                  onChange={(e) => setRecompressState(prev => ({ ...prev, [idx]: { ...prev[idx], level: parseInt(e.target.value) } }))}
                                  disabled={rState.loading}
                                  className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600 mb-4"
                                />
                                <div className="flex justify-end space-x-2">
                                   <button 
                                     onClick={() => setRecompressState(prev => { const next = {...prev}; delete next[idx]; return next; })}
                                     disabled={rState.loading}
                                     className="px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700 font-medium"
                                   >
                                     Cancel
                                   </button>
                                   <button
                                     onClick={() => handleRecompressSubmit(idx)}
                                     disabled={rState.loading}
                                     className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg flex items-center transition-colors disabled:opacity-70"
                                   >
                                     {rState.loading ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <CheckCircle className="w-4 h-4 mr-1.5" />}
                                     {rState.loading ? 'Compressing...' : 'Apply'}
                                   </button>
                                </div>
                                {rState.error && <p className="text-xs text-red-500 mt-2 text-right">{rState.error}</p>}
                             </div>
                         )}
                      </div>
                    )})}
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row items-center justify-center space-y-3 sm:space-y-0 sm:space-x-4">
                  <button
                    onClick={() => {
                      results.files.forEach((fileResult) => {
                        const link = document.createElement('a');
                        link.href = `/api/jobs/${fileResult.jobId}/download/${fileResult.fileIndex}`;
                        link.setAttribute('download', `compressed_${fileResult.originalName}`);
                        document.body.appendChild(link);
                        link.click();
                        document.body.removeChild(link);
                      });
                    }}
                    className="w-full sm:w-auto bg-blue-600 hover:bg-blue-700 text-white font-medium py-3.5 px-8 rounded-xl transition-all flex items-center justify-center shadow-lg shadow-blue-200"
                  >
                    <Download className="w-5 h-5 mr-2" />
                    {results.files.length > 1 ? 'Download All Files' : 'Download PDF'}
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
