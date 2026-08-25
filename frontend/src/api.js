import axios from 'axios';

/**
 * Determine the API Base URL:
 * 1. Explicit environment variable `VITE_API_URL` if defined.
 * 2. When hosted on Vercel (`*.vercel.app`), connect directly to the Render backend
 *    (`https://pdfcompressor-wypc.onrender.com`) to bypass Vercel's 4.5 MB body limit
 *    and 10s rewrite timeout.
 * 3. Otherwise (local dev proxy or backend serving static frontend), use relative path.
 */
export const getApiBaseUrl = () => {
  if (import.meta.env.VITE_API_URL) {
    return import.meta.env.VITE_API_URL.replace(/\/$/, '');
  }
  if (typeof window !== 'undefined' && window.location.hostname.includes('vercel.app')) {
    return 'https://pdfcompressor-wypc.onrender.com';
  }
  return '';
};

export const API_BASE_URL = getApiBaseUrl();

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 120000, // 2-minute timeout for large files & Render free tier spin-up
});

/**
 * Get full download URL for a file ID or path
 */
export const getDownloadUrl = (pathOrId) => {
  if (!pathOrId) return '';
  if (pathOrId.startsWith('http://') || pathOrId.startsWith('https://')) {
    return pathOrId;
  }
  const cleanPath = pathOrId.startsWith('/') ? pathOrId : `/api/download/${pathOrId}`;
  return `${API_BASE_URL}${cleanPath}`;
};

/**
 * Get bulk download ZIP URL
 */
export const getDownloadAllUrl = (ids) => {
  if (!ids || ids.length === 0) return '';
  const idsParam = Array.isArray(ids) ? ids.join(',') : ids;
  return `${API_BASE_URL}/api/download-all?ids=${encodeURIComponent(idsParam)}`;
};

/**
 * Warm up the backend instance (Render free tier cold start)
 */
export const checkBackendHealth = async () => {
  try {
    const response = await apiClient.get('/health', { timeout: 30000 });
    return { ok: true, data: response.data };
  } catch (err) {
    return { ok: false, error: err.message };
  }
};
