import { marked } from "marked";
import { chromium } from "playwright";
import type { ReportScreenshot } from "../gemini/report";

type ReviewReportPdfInput = {
  markdown: string;
  screenshots: ReportScreenshot[];
};

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildScreenshotSectionHtml(screenshots: ReportScreenshot[]) {
  if (screenshots.length === 0) {
    return "";
  }

  return `
    <section class="screenshots">
      <h2>Captured Screenshots</h2>
      <div class="screenshot-grid">
        ${screenshots
          .map((screenshot, index) => {
            const label = screenshot.label?.trim()
              ? escapeHtml(screenshot.label)
              : `Screenshot ${index + 1}`;

            return `
              <figure class="screenshot-card">
                <img src="${screenshot.imageDataUrl}" alt="${label}" />
                <figcaption>
                  <strong>${label}</strong><br />
                  Captured at ${escapeHtml(screenshot.timestamp)}
                </figcaption>
              </figure>
            `;
          })
          .join("")}
      </div>
    </section>
  `;
}

function buildPdfHtml(reportHtml: string, screenshots: ReportScreenshot[]) {
  const generatedAt = new Date().toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });

  return `
    <!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <title>Art Director AI Review Report</title>
        <style>
          @page {
            margin: 22mm 16mm 20mm;
          }

          * {
            box-sizing: border-box;
          }

          body {
            margin: 0;
            color: #18181b;
            font-family: "Segoe UI", Arial, sans-serif;
            font-size: 14px;
            line-height: 1.75;
            background: #ffffff;
          }

          main {
            width: 100%;
          }

          .report-header {
            margin-bottom: 24px;
            padding: 18px 20px;
            border: 1px solid #e4e4e7;
            border-radius: 18px;
            background: linear-gradient(135deg, #fafaf9 0%, #f5f5f4 45%, #ecfeff 100%);
          }

          .eyebrow {
            margin: 0 0 6px;
            color: #71717a;
            font-size: 11px;
            font-weight: 600;
            letter-spacing: 0.12em;
            text-transform: uppercase;
          }

          .report-header h1 {
            margin: 0;
            font-size: 30px;
            line-height: 1.2;
          }

          .generated-at {
            margin: 10px 0 0;
            color: #52525b;
            font-size: 12px;
          }

          .report-body h1,
          .report-body h2,
          .report-body h3 {
            color: #09090b;
            line-height: 1.25;
            margin-top: 24px;
            margin-bottom: 12px;
          }

          .report-body h1 {
            font-size: 26px;
          }

          .report-body h2 {
            font-size: 22px;
          }

          .report-body h3 {
            font-size: 18px;
          }

          .report-body p,
          .report-body ul,
          .report-body ol,
          .report-body blockquote {
            margin-top: 0;
            margin-bottom: 12px;
          }

          .report-body ul,
          .report-body ol {
            padding-left: 20px;
          }

          .report-body li + li {
            margin-top: 6px;
          }

          .report-body strong {
            color: #09090b;
          }

          .report-body a {
            color: #0f766e;
            text-decoration: underline;
            text-underline-offset: 3px;
          }

          .report-body hr {
            border: 0;
            border-top: 1px solid #e4e4e7;
            margin: 24px 0;
          }

          .report-body code {
            padding: 2px 6px;
            border-radius: 6px;
            background: #f4f4f5;
            font-family: "Cascadia Code", "Consolas", monospace;
            font-size: 12px;
          }

          .report-body pre {
            overflow-wrap: anywhere;
            white-space: pre-wrap;
            padding: 14px;
            border-radius: 12px;
            background: #f4f4f5;
            font-family: "Cascadia Code", "Consolas", monospace;
            font-size: 12px;
          }

          .screenshots {
            margin-top: 32px;
            padding-top: 20px;
            border-top: 1px solid #d4d4d8;
          }

          .screenshots h2 {
            margin: 0 0 16px;
            font-size: 22px;
          }

          .screenshot-grid {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 16px;
          }

          .screenshot-card {
            margin: 0;
            padding: 12px;
            border: 1px solid #e4e4e7;
            border-radius: 16px;
            background: #fafafa;
            break-inside: avoid;
          }

          .screenshot-card img {
            display: block;
            width: 100%;
            height: auto;
            border: 1px solid #e4e4e7;
            border-radius: 10px;
            background: #ffffff;
          }

          .screenshot-card figcaption {
            margin-top: 10px;
            color: #52525b;
            font-size: 12px;
            line-height: 1.5;
          }
        </style>
      </head>
      <body>
        <main>
          <header class="report-header">
            <p class="eyebrow">Adai</p>
            <h1>Art Direction Report</h1>
            <p class="generated-at">Generated ${escapeHtml(generatedAt)}</p>
          </header>

          <section class="report-body">
            ${reportHtml}
          </section>

          ${buildScreenshotSectionHtml(screenshots)}
        </main>
      </body>
    </html>
  `;
}

/**
 * Converts the generated Markdown report into a simple PDF layout.
 * This stays separate from Gemini report generation so the export flow
 * remains easy to understand and swap later if needed.
 */
export async function generateReviewReportPdf(input: ReviewReportPdfInput) {
  const reportHtml = await marked.parse(input.markdown);

  // Chromium needs a couple of extra flags in container runtimes such as Cloud Run.
  const browser = await chromium.launch({
    args: ["--disable-dev-shm-usage", "--no-sandbox"],
  });

  try {
    const page = await browser.newPage();

    await page.setContent(buildPdfHtml(reportHtml, input.screenshots), {
      waitUntil: "load",
    });

    return await page.pdf({
      format: "A4",
      printBackground: true,
      margin: {
        top: "22mm",
        right: "16mm",
        bottom: "20mm",
        left: "16mm",
      },
    });
  } finally {
    await browser.close();
  }
}
