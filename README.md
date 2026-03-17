# Adai — Art Director AI

**Adai** is a live AI art director for 3D game artists.

Connect a viewport from Blender, Substance Painter, Marmoset, or any other tool, speak naturally, and get real-time spoken feedback from a senior art director AI. When the session is done, Adai generates a detailed written review report with a PDF export.

## What It Does

- Live voice conversation with an AI art director
- Screen sharing so Adai sees your asset in real time
- Spoken feedback on materials, textures, wear, readability, silhouette, and overall polish
- Style-aware review — Adai judges the asset against its intended style, not against a generic standard
- Automatic report generation at the end of the session
- PDF export of the final report with findings and curated learning resources

## Stack

- **Framework:** Next.js 15 (App Router)
- **Language:** TypeScript
- **AI:** Gemini Live API + Gemini 2.5 Flash (report generation)
- **SDK:** Google GenAI SDK (`@google/genai`)
- **Styling:** Tailwind CSS
- **PDF Export:** html2pdf.js

## Local Development

### Requirements

- Node.js 20 or newer
- npm
- A Gemini API key (from [Google AI Studio](https://aistudio.google.com/apikey))

### Environment Variables

Create a `.env.local` file in the project root:

```bash
GEMINI_API_KEY=your_gemini_api_key
```

### Install and Run

```bash
npm install
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000).

### Build

```bash
npm run build
npm run start
```

## User Flow

<<<<<<< HEAD
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

The frontend is deployed to **Google Cloud Run** from source..

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
=======
1. Open the app
2. Enter your name
3. Enable microphone
4. Share your screen — point it at your 3D viewport
5. Click **Begin Art Review** — Adai connects and greets you
6. Talk to Adai and show the asset; rotate, zoom, and show different angles as requested
7. Click **I'm ready to get the final report** when done
8. Wait for the report to generate
9. Download the PDF
>>>>>>> 57809924c14e1dff5ab0bb85cb30376789e8350a
