# Art Director AI

Art Director AI is a live AI art director for 3D game artists.

It reviews textured 3D assets through live voice and screen sharing, gives professional art-direction feedback, and generates a detailed review report with PDF export when the session is finished.

This project was created for the **Gemini Live Agent Challenge** in the **Live Agents** category.

---

## What it does

Art Director AI helps 3D artists review game assets in a more natural way than a normal chatbot.

The user can:

- share a Blender, Substance Painter, Marmoset, or other viewport window
- speak naturally through the microphone
- get live feedback from Gemini
- rotate and zoom the model as requested
- finish the review and automatically generate a detailed report
- download that report as a PDF

The goal is to make the experience feel closer to a live review call with a senior art director.

---

## Core Features

- Live Gemini review session
- Screen sharing
- Microphone streaming
- Spoken Gemini responses
- Review transcript
- Automatic report generation when the review is finished
- PDF export

---

## Stack

- **Frontend:** Next.js + TypeScript
- **Backend:** Node.js + TypeScript + Express
- **Realtime AI:** Gemini Live API
- **SDK:** Google GenAI SDK
- **PDF Export:** Markdown -> HTML -> PDF
- **Target Cloud Hosting:** Google Cloud Run

---

## Project Structure

```txt
frontend/   # Next.js app
backend/    # Express + Gemini Live backend
Requirements

Before running the project, make sure you have:

Node.js 20 or newer

npm

a valid Gemini API key

Environment Variables

The backend reads environment variables from these files if they exist, in a beginner-friendly order:

backend/.env.local

backend/.env

.env.local

.env

The recommended option is:

backend/.env.local
Required variables

GEMINI_API_KEY
Used for all Gemini-backed backend routes and Live API sessions.

Optional variables

LIVE_MODEL
Overrides the default live model. If omitted, the backend uses its built-in default.

PORT
Optional local override for the backend port. Defaults to 8080. Cloud Run provides this automatically in production.

Example backend/.env.local
GEMINI_API_KEY=your_real_gemini_api_key
LIVE_MODEL=gemini-2.5-flash-native-audio-preview-12-2025
Install Dependencies

From the repository root, run:

npm install
Run Locally

Start the backend:

npm run dev:backend

Start the frontend in a separate terminal:

npm run dev:frontend

Then open:

http://localhost:3000
Build

Build the frontend:

npm run build:frontend

Build the backend:

npm run build:backend

Run the backend in production-style mode locally:

npm run start:backend
Backend Local Run
Health check
GET /health

Expected response:

{ "ok": true }

When the backend is running locally, the health URL is:

http://localhost:8080/health
Config check
GET /config

Example response:

{
  "hasGeminiKey": true,
  "liveModel": "gemini-2.5-flash-native-audio-preview-12-2025"
}
How To Test The MVP

Start the backend:

npm run dev:backend

Start the frontend:

npm run dev:frontend

Open the app:

http://localhost:3000

Click Enable Microphone and allow browser microphone access.

Click Share Screen and select the app window or screen that shows your 3D model.

Click Connect Live Review.

Talk to Art Director AI and show the asset on screen.

Continue the review by rotating or zooming the model as requested.

Click Finish Review when the session is done.

Wait for the report to be generated automatically.

Click Download PDF to save the report.

Reproducible Testing Notes For Judges

To reproduce the main flow:

Clone the repository

Create backend/.env.local with a valid GEMINI_API_KEY

Run npm install

Start backend with npm run dev:backend

Start frontend with npm run dev:frontend

Open http://localhost:3000

Allow microphone and screen-sharing permissions

Start a live review session

Speak and show a 3D asset on screen

Finish the review to generate the report

Download the PDF

Intended User Flow

User opens the app

User enables microphone

User shares screen

User connects live review

Gemini reviews the asset through voice and visual context

User continues the review by rotating or zooming the model

User clicks Finish Review

The app generates a final report automatically

User downloads the PDF