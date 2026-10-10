# Kenora QR Studio

A production-minded full-stack QR code studio for KenoraTech. It creates branded, downloadable QR codes for websites, Wi-Fi, WhatsApp, UPI, contact cards, locations, and more.

## Features

- Live QR preview with safe color, size, margin, and error-correction controls
- PNG and SVG downloads, plus Web Share / clipboard fallback
- JWT authentication and private saved QR collections
- Express REST API with validation, Helmet, CORS, request logging, and centralized errors
- Responsive React/Vite user experience

## Architecture

`client/` is a React/Vite application and only communicates with `server/` through Axios REST calls. `server/` owns validation, JWT authentication, business logic, and MongoDB persistence through Mongoose.

## Setup

1. Copy `server/.env.example` to `server/.env` and supply `MONGODB_URI` and a strong `JWT_SECRET`.
2. Run `npm install` at the repository root, then run `npm install` in both `client` and `server`.
3. Start development with `npm run dev`.

Client: `http://127.0.0.1:5173` · API: `http://127.0.0.1:5000`

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

Every protected QR query is scoped to the current JWT user. Generated images are intentionally not stored; the underlying payload and customization are persisted instead.

## Screenshots

Add showcase screenshots here after deployment.
