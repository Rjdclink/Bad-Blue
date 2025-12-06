import puppeteer from 'puppeteer';
import { promises as fs } from 'fs';
import path from 'path';

interface RenderConfig {
  htmlPath: string;
  outputPath: string;
  caseId: string;
  width?: number;
  height?: number;
}

export class MapRenderer {
  async renderMapScreenshot(config: RenderConfig): Promise<string> {
    const { htmlPath, outputPath, caseId, width = 1920, height = 1080 } = config;

    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    });

    try {
      const page = await browser.newPage();
      await page.setViewport({ width, height });

      const htmlContent = await fs.readFile(htmlPath, 'utf-8');
      await page.setContent(htmlContent, { waitUntil: 'networkidle0' });

      await page.waitForFunction(() => (window as any).mapReady === true, { timeout: 30000 });
      await new Promise(resolve => setTimeout(resolve, 2000));

      const screenshotPath = path.join(outputPath, `map-${caseId}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: false });

      console.log(`[MapRenderer] Screenshot saved: ${screenshotPath}`);
      return screenshotPath;
    } finally {
      await browser.close();
    }
  }

  async renderMultipleMaps(configs: RenderConfig[]): Promise<string[]> {
    const results = await Promise.all(
      configs.map(config => this.renderMapScreenshot(config))
    );
    return results;
  }
}

export const mapRenderer = new MapRenderer();
