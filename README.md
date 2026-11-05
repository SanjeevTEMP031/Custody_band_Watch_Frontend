# Trackin360 Admin

React, TypeScript, and Vite frontend for the Custody Band API.

## Run locally

1. Start the API at `http://192.168.10.93:8002`.
2. From this directory, run `npm install` once and then `npm run dev`.
3. Open the Vite URL and sign in with an API account.

The Vite development server proxies `/api/*` to `http://192.168.10.93:8002`, so browser API requests use the same origin and do not require browser-side CORS configuration.

To use a different API host, set `VITE_API_BASE_URL` to its API base path, for example `https://api.example.com/api/v1` or `http://192.168.10.93:8002/api/v1`. In deployments where the frontend and API use different origins, configure the API CORS policy for the frontend origin.

The monitoring center can display Google Maps in embedded mode without an API key. To enable device markers and aggregate view on the Google map, set `VITE_GOOGLE_MAPS_API_KEY` in a local `.env` file in this directory, enable the Maps JavaScript API and billing for that key, and restart Vite.

## Backend integration

The frontend uses the documented `/api/v1` endpoints for login, current user, people/custody, devices, location history, geofences, alerts, and dashboard data. The API does not currently define attendance, report, or settings endpoints; those screens state that limitation rather than displaying generated sample values.

The access token is stored in browser local storage and sent as a Bearer token. Signing out removes it.

## Validation

- `npm run build`
- `npm run lint`
