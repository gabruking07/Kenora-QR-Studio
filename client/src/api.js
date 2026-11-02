import axios from "axios";

// Keep the localhost default for development, but never bake a developer's
// localhost URL into a production build. Hosted deployments should set
// VITE_API_URL to the backend's /api endpoint (or configure an /api proxy).
const configuredApiBase = import.meta.env.VITE_API_URL?.trim();
const pointsToLocalhost =
  configuredApiBase &&
  /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(configuredApiBase);
const apiBase =
  configuredApiBase && !(import.meta.env.PROD && pointsToLocalhost)
    ? configuredApiBase
    : import.meta.env.DEV
      ? "http://127.0.0.1:5000/api"
      : "/api";

const api = axios.create({ baseURL: apiBase });
api.interceptors.request.use((config) => {
  const token = localStorage.getItem("kenora_token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export default api;
