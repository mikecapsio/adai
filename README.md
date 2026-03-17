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

1. Open the app
2. Enter your name
3. Enable microphone
4. Share your screen — point it at your 3D viewport
5. Click **Begin Art Review** — Adai connects and greets you
6. Talk to Adai and show the asset; rotate, zoom, and show different angles as requested
7. Click **I'm ready to get the final report** when done
8. Wait for the report to generate
9. Download the PDF
