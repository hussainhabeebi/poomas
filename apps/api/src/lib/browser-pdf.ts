// Browser Rendering helpers — HTML → PDF and HTML → PNG
// Requires: [browser] binding in wrangler.toml + @cloudflare/puppeteer devDep

import puppeteer from "@cloudflare/puppeteer";

export async function htmlToPdf(browser: BrowserWorker, html: string): Promise<ArrayBuffer> {
  const b = await puppeteer.launch(browser);
  try {
    const page = await b.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });
    await page.emulateMediaType("print");
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "12mm", right: "12mm", bottom: "12mm", left: "12mm" },
    });
    return pdf.buffer as ArrayBuffer;
  } finally {
    await b.close();
  }
}

export async function htmlToPng(
  browser: BrowserWorker,
  html: string,
  width = 1200,
  height = 630,
): Promise<Buffer> {
  const b = await puppeteer.launch(browser);
  try {
    const page = await b.newPage();
    await page.setViewport({ width, height, deviceScaleFactor: 2 });
    await page.setContent(html, { waitUntil: "networkidle0" });
    const screenshot = await page.screenshot({ type: "png", clip: { x: 0, y: 0, width, height } });
    return screenshot as Buffer;
  } finally {
    await b.close();
  }
}
