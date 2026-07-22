import puppeteer, { Browser, Page } from 'puppeteer';

class BrowserController {
  private browser: Browser | null = null;
  private page: Page | null = null;

  async init(headless: boolean = true) {
    if (!this.browser) {
      this.browser = await puppeteer.launch({
        headless: headless ? true : false,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      });
      this.page = await this.browser.newPage();
      // Set viewport for consistent rendering
      await this.page.setViewport({ width: 1280, height: 800 });
    }
  }

  async navigate(url: string, headless: boolean = true): Promise<string> {
    await this.init(headless);
    if (!this.page) return 'Error: Page not initialized.';
    
    try {
      await this.page.goto(url, { waitUntil: 'networkidle2' });
      const title = await this.page.title();
      return `Successfully navigated to ${url}. Page title is: "${title}"`;
    } catch (e: any) {
      return `Failed to navigate to ${url}: ${e.message}`;
    }
  }

  async click(selector: string): Promise<string> {
    if (!this.page) return 'Error: Browser not initialized. Please navigate to a URL first.';
    
    try {
      await this.page.waitForSelector(selector, { timeout: 5000 });
      await this.page.click(selector);
      return `Successfully clicked element matching '${selector}'.`;
    } catch (e: any) {
      return `Failed to click selector '${selector}': ${e.message}`;
    }
  }

  async type(selector: string, text: string): Promise<string> {
    if (!this.page) return 'Error: Browser not initialized. Please navigate to a URL first.';
    
    try {
      await this.page.waitForSelector(selector, { timeout: 5000 });
      await this.page.type(selector, text);
      return `Successfully typed text into '${selector}'.`;
    } catch (e: any) {
      return `Failed to type into selector '${selector}': ${e.message}`;
    }
  }

  async extractText(selector: string): Promise<string> {
    if (!this.page) return 'Error: Browser not initialized. Please navigate to a URL first.';
    
    try {
      await this.page.waitForSelector(selector, { timeout: 5000 });
      const text = await this.page.$eval(selector, (el: any) => el.innerText || el.textContent);
      return text || '';
    } catch (e: any) {
      return `Failed to extract text from '${selector}': ${e.message}`;
    }
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.page = null;
    }
  }
}

export const BrowserService = new BrowserController();
