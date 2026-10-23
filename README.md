# Kenora QR Studio

A production-minded full-stack QR code studio for KenoraTech. It creates branded, downloadable QR codes for websites, Wi-Fi, WhatsApp, UPI, contact cards, locations, and more.

## Features

- Live QR preview with safe color, size, margin, and error-correction controls
- PNG and SVG downloads, plus Web Share / clipboard fallback
- JWT authentication and private saved QR collections
- Express REST API with validation, Helmet, CORS, request logging, and centralized errors
- Responsive React/Vite user experience
- Password-protected photo and video albums with expiring links, private Cloudinary assets, ZIP downloads, and manual expired-file retention

## Architecture

`client/` is a React/Vite application and only communicates with `server/` through Axios REST calls. `server/` owns validation, JWT authentication, business logic, and MongoDB persistence through Mongoose.

## Setup

1. Copy `server/.env.example` to `server/.env`, set `MONGODB_URI` to a reachable MongoDB instance, and replace `JWT_SECRET` with a strong random value. The example URI expects MongoDB to be running locally; for Atlas, use your cluster connection string and allow the development machine's IP in the cluster network access settings.
2. Create a Cloudinary Image & Video account. Find the cloud name, API key, and API secret in the Cloudinary Console dashboard, then set `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, and `CLOUDINARY_API_SECRET` in `server/.env`. Keep the API secret on the backend; never add it to a `VITE_` variable.
3. Run `npm install` at the repository root, then run `npm install` in both `client` and `server`.
4. Start development with `npm run dev`.

Client: `http://127.0.0.1:5173` · API: `http://127.0.0.1:5000`

The API connects to MongoDB before it starts listening. If the connection fails, startup prints the connection error and exits instead of accepting login requests that would otherwise time out.

## Media sharing

Sign in and choose **Media Sharing**. Album owners can upload up to 100 photos/videos, 2 GB total per share, and three concurrent uploads. The implementation caps each file at Cloudinary Free plan limits: 10 MB per image and 100 MB per video, even if higher application limits are configured. Supported formats are JPEG, PNG, WebP, GIF, AVIF, HEIC, HEIF, MP4, MOV, M4V, and WebM. Passwords are bcrypt-hashed; shared media is uploaded as Cloudinary `authenticated` assets. The public page receives time-limited signed access only after the password is checked. ZIPs stream through the API and do not rely on Render's temporary filesystem.

Cloudinary Free currently provides 25 shared credits for storage, transformations, and delivery. One credit corresponds to 1 GB of managed storage, 1 GB of image/video delivery bandwidth on Free, or 1,000 transformations (usage is combined). Album downloads and video playback use bandwidth, so this is not unlimited storage or free unlimited downloads. Check the current [Cloudinary billing guide](https://cloudinary.com/documentation/billing_and_plans) and [plan file-size limits](https://cloudinary.com/pricing/compare-plans) before launch. The app enforces per-file limits, but it cannot inspect your account's remaining credit balance; monitor usage in Cloudinary Console.

### Production configuration

- **Render API:** set the service root directory to `server`, build command to `npm ci`, and start command to `npm start`. Set `MONGODB_URI`, `JWT_SECRET`, `CLIENT_URL` (your Vercel production domain, plus any preview domains as comma-separated origins), and the three Cloudinary variables in Render's service environment. Render supplies `PORT`; the API listens on it. Set `VITE_API_URL` on Vercel to the Render API URL ending in `/api`. No Cloudinary secret belongs in Vercel.
- **Vercel client:** set the project root directory to `client`, build command to `npm run build`, output directory to `dist`, and `VITE_API_URL` to the Render API URL ending in `/api`. The Vercel rewrite supports React Router deep links such as `/media/:token`. For local development, `client/.env.example` shows the API URL setting.
- **MongoDB:** Mongoose creates the declared indexes when the API connects. No destructive data migration is required.
- **Abandoned uploads/deletion retries:** optionally set a random `MEDIA_CLEANUP_SECRET` in Render and configure a Render Cron Job (or another scheduler) to POST to `/api/media/internal/cleanup` with `Authorization: Bearer <secret>`. It marks expired shares, releases stale upload reservations, and retries incomplete deletions. Expiry is also checked on every public access; the scheduler is for cleanup only. Keep the cron command secret in its environment, not in source control.
- **Limits:** optional `MEDIA_MAX_*` environment settings can lower the app policy. They cannot raise the Cloudinary Free per-file caps. The 25-credit plan balance is account-wide and cannot be reliably used as an application quota, so monitor it in Cloudinary.

### Tests and troubleshooting

Run `npm test` in `server/` and `npm run build` in `client/`. The backend tests use a local Express app and do not connect to MongoDB or Cloudinary. For end-to-end upload tests, use a dedicated Cloudinary test product environment and a non-production MongoDB database. Verify the authenticated asset's direct URL is inaccessible, password unlock works, and an expired/revoked link stops issuing new access. Never test deletion against production media.

- `Media sharing is not configured`: set all three Cloudinary credentials on the server and restart it.
- `Invalid signature` or upload failures: check cloud name/key/secret belong to the same Cloudinary product environment and that the account's plan accepts the file size.
- `413` for an image/video: Free allows up to 10 MB images and 100 MB videos under the current plan comparison; reduce the file or check the current plan's limits.
- Access/CORS errors: set `CLIENT_URL` to the exact Vercel origin, with no path, and `VITE_API_URL` to the Render API `/api` endpoint.
- ZIP or asset deletion errors: retry the operation or run the cleanup endpoint; failed items remain tracked in MongoDB for retry.

### Rollback

To roll back the feature, redeploy the prior application version and remove the Media Sharing navigation/routes. Do not delete the MongoDB collections or Cloudinary assets as part of rollback; shares and retained media can be re-enabled by restoring the feature version. Revoke/delete shares before intentionally removing their assets.

## Commands

- `npm run dev` — client and server together
- `npm run client` — Vite client
- `npm run server` — Express API
- `npm run build` — client production build

## Main API

| Method | Endpoint | Auth |
| --- | --- | --- |
| POST | `/api/auth/register` | No |
| POST | `/api/auth/login` | No |
| GET | `/api/auth/me` | Yes |
| GET/POST | `/api/qr` | Yes |
| GET/PUT/DELETE | `/api/qr/:id` | Yes |
| POST/GET/PATCH/DELETE | `/api/media/shares` | Yes |
| POST | `/api/media/shares/:id/uploads/initiate` | Yes |
| POST | `/api/media/shares/:id/uploads/:uploadId/complete` | Yes |
| POST | `/api/media/public/:token/verify-password` | No |
| GET | `/api/media/public/:token` | Password grant |
| GET | `/api/media/public/:token/files/:fileId/access` | Password grant |
| GET | `/api/media/public/:token/download-all` | Short-lived ticket |

Every protected QR query is scoped to the current JWT user. Generated images are intentionally not stored; the underlying payload and customization are persisted instead.

## Screenshots

Add showcase screenshots here after deployment.
