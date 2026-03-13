# Art Director AI

**Art Director AI** is a live AI art director for 3D game artists.

It reviews textured 3D assets through **live voice + screen sharing**, provides art-direction feedback in real time, and generates a detailed review report with **PDF export** when the session is finished.

This project was created for the **Gemini Live Agent Challenge** in the **Live Agents** category.

## Demo Access

A live demo was deployed on Google Cloud Run during development and judging preparation.

For public repository safety, direct deployment URLs are not listed in this README.

> Best experienced on desktop Chrome with microphone and screen-sharing permissions enabled.

## What It Does

Art Director AI helps 3D artists review game assets in a more natural way than a normal chatbot.

The user can:

- share a Blender, Substance Painter, Marmoset, or other viewport window
- speak naturally through the microphone
- get live spoken feedback from Gemini
- rotate and zoom the model as requested during the review
- finish the review and automatically generate a detailed report
- download the final report as a PDF

The goal is to make the experience feel closer to a live review call with a senior art director.

## Core Features

- Live Gemini review session
- Screen sharing
- Microphone streaming
- Spoken Gemini responses
- Review transcript
- Automatic report generation when the review is finished
- PDF export

## Stack

- **Frontend:** Next.js + TypeScript
- **Backend:** Node.js + TypeScript + Express
- **Realtime AI:** Gemini Live API
- **SDK:** Google GenAI SDK
- **PDF Export:** Markdown → HTML → PDF
- **Cloud Hosting:** Google Cloud Run

## Project Structure

```text
frontend/   # Next.js app
backend/    # Express + Gemini Live backend
```

## Requirements

Before running the project, make sure you have:

- **Node.js 20** or newer
- **npm**
- a valid **Gemini API key**

## Environment Variables

The backend reads environment variables from these files if they exist, in this order:

1. `backend/.env.local`
2. `backend/.env`
3. `.env.local`
4. `.env`

The recommended option is:

- `backend/.env.local`

### Required Variables

#### `GEMINI_API_KEY`

Used for all Gemini-backed backend routes and Live API sessions.

#### `TEST_PROMPT_MODEL`

Used for report generation and other text-based Gemini calls.

### Optional Variables

#### `LIVE_MODEL`

Overrides the default live model. If omitted, the backend uses its built-in default.

#### `PORT`

Optional local override for the backend port. Defaults to `8080`. Cloud Run provides this automatically in production.

### Example `backend/.env.local`

```bash
GEMINI_API_KEY=your_real_gemini_api_key
TEST_PROMPT_MODEL=gemini-2.5-flash
LIVE_MODEL=gemini-2.5-flash-native-audio-preview-12-2025
```

## Install Dependencies

From the repository root, run:

```bash
npm install
```

## Run Locally

Start the backend:

```bash
npm run dev:backend
```

Start the frontend in a separate terminal:

```bash
npm run dev:frontend
```

Then open:

```text
http://localhost:3000
```

## Build

Build the frontend:

```bash
npm run build:frontend
```

Build the backend:

```bash
npm run build:backend
```

Run the backend in production-style mode locally:

```bash
npm run start:backend
```

## Backend Local Checks

### Health Check

**GET** `/health`

Expected response:

```json
{ "ok": true }
```

When the backend is running locally, the health URL is:

```text
http://localhost:8080/health
```

### Config Check

**GET** `/config`

Example response:

```json
{
  "hasGeminiKey": true,
  "liveModel": "gemini-2.5-flash-native-audio-preview-12-2025"
}
```

## How to Test the MVP

1. Start the backend:

   ```bash
   npm run dev:backend
   ```

2. Start the frontend:

   ```bash
   npm run dev:frontend
   ```

3. Open the app:

   ```text
   http://localhost:3000
   ```

4. Click **Enable Microphone** and allow browser microphone access.
5. Click **Share Screen** and select the app window or screen that shows your 3D model.
6. Click **Connect Live Review**.
7. Talk to Art Director AI and show the asset on screen.
8. Continue the review by rotating or zooming the model as requested.
9. Click **Finish Review** when the session is done.
10. Wait for the report to be generated automatically.
11. Click **Download PDF** to save the report.

## Reproducible Testing Notes for Judges

To reproduce the main flow:

1. Clone the repository.
2. Create `backend/.env.local` with a valid `GEMINI_API_KEY`.
3. Add `TEST_PROMPT_MODEL`, for example:

   ```bash
   TEST_PROMPT_MODEL=gemini-2.5-flash
   ```

4. Run:

   ```bash
   npm install
   ```

5. Start the backend:

   ```bash
   npm run dev:backend
   ```

6. Start the frontend:

   ```bash
   npm run dev:frontend
   ```

7. Open:

   ```text
   http://localhost:3000
   ```

8. Allow microphone and screen-sharing permissions.
9. Start a live review session.
10. Speak and show a 3D asset on screen.
11. Finish the review to generate the report.
12. Download the PDF.

## Intended User Flow

1. User opens the app
2. User enables microphone
3. User shares screen
4. User connects live review
5. Gemini reviews the asset through voice and visual context
6. User continues the review by rotating or zooming the model
7. User clicks **Finish Review**
8. The app generates a final report automatically
9. User downloads the PDF

## Deployment

### Backend

The backend is deployed to **Google Cloud Run** using:

- `backend/Dockerfile`
- `backend/cloudbuild.yaml`

Cloud Run is configured with:

- `GEMINI_API_KEY` from **Google Secret Manager**
- `TEST_PROMPT_MODEL` as an environment variable
- container port `8080`
- `1Gi` memory for Playwright / PDF export

### Frontend

The frontend is deployed to **Google Cloud Run** from source.

## Notes

- This repository is published publicly for **hackathon judging and demonstration purposes**.
- Secrets are **not included** in this repository.
- Use `.env.example` as a reference for local setup.
- Depending on Gemini project quota/tier status, report generation requests may be affected by API rate limits.

## Built With

- **TypeScript**
- **Next.js**
- **Node.js**
- **Express**
- **Tailwind CSS**
- **Google GenAI SDK**
- **Gemini Live API**
- **Google Cloud Run**
- **Google Secret Manager**
- **Google Cloud Build**
```
