import { PlaywrightCrawler, ProxyConfiguration, RequestQueue, Dataset } from 'crawlee';
import { createPlaywrightRouter } from 'crawlee';
import { domains } from './domains.json';
import { CONSTANTS } from './constants.js';

const lookbackDays = 30;

const gNewsLinks = await Dataset.open('gnews-links');
const articleDataset = await Dataset.open('articles');
const articleQueue = await RequestQueue.open('article-queue');

const router = createPlaywrightRouter();

router.addDefaultHandler(async ({ log, request, page }) => {
  // This should receive urls to google news search pages
  log.info(`Collecting links from ${request.loadedUrl}`);

  // await enqueueLinks({
  //   label: 'to-article',
  //   strategy: 'all',
  //   selector: 'c-wiz[class="PO9Zff Ccj79 kUVvS"] a[class="JtKRv"]',
  //   globs: ['https://news.google.com/read/*']
  // });

  const articles: {
    title: string
    url: string
   }[] = [];

  for(const container of  await page.locator('c-wiz[class="PO9Zff Ccj79 kUVvS"]').all()) {
    // the title is in an anchor with the selector a[class="JtKRv"]
    const articleTitle = await container.locator('a[class="JtKRv"]').first().innerText();
    // url is in the same anchor, it's a relative url such as "'./read/CBMipAFBVV95cUxPO..." we need to append the base url
    // base is https://news.google.com/read
    const articleUrl = await container.locator('a[class="JtKRv"]').first().getAttribute('href');
    const fullUrl = new URL(articleUrl!, 'https://news.google.com').href;

    await articleQueue.addRequest({ url: fullUrl, label: 'to-article' });

    articles.push({
      title: articleTitle,
      url: fullUrl
    });
  }

  log.info(`Found ${articles.length} articles on ${request.loadedUrl}`);
  console.log(articles.slice(0,1));

  if(!!articles.length) {
    // Saving the raw results just in case
    gNewsLinks.pushData(articles);
  }

});

async function waitForNonGoogleUrl(page: any, timeout: number = 10000): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const intervalTime = 100; // check every 100ms
    const startTime = Date.now();

    const checkUrl = async () => {
      if (!page.url().includes('google.com')) {
        resolve();
      } else if (Date.now() - startTime > timeout) {
        reject(new Error('Timeout waiting for non-google.com URL'));
      } else {
        setTimeout(checkUrl, intervalTime);
      }
    };

    // Start the URL checking loop
    checkUrl();
  });
}

let good = 0;

router.addHandler('to-article', async ({ page, log, session }) => {

  try {
    await waitForNonGoogleUrl(page, 10000);

    const currentUrl = page.url();
    const url = new URL(currentUrl);
    const hostnameNoWWW = url.hostname.replace('www.', '');

    good++;

    log.info(`🟢 [${good}] Resolved - ${currentUrl}`);

    await articleDataset.pushData({
      hostname: hostnameNoWWW,
      articleUrl: currentUrl
    });

    session?.markGood();
  } catch (error) {
    if(error instanceof Error) {
      log.error(`🔻 Error processing article - ${error.message}`);
    }
    session?.markBad();
  }

});

const crawler = new PlaywrightCrawler({
  proxyConfiguration: new ProxyConfiguration({ proxyUrls: CONSTANTS.PROXY_URLS }),
  useSessionPool: true,
  persistCookiesPerSession: true,
  requestHandler: router,
  requestQueue: articleQueue,
  launchContext: {
    useChrome: true,
  },
  maxConcurrency: 3,
  maxRequestRetries: 10,
  failedRequestHandler: async ({ request, log }) => {
    log.error(`🔺 Request ${request.url} failed`);
  }
});

const googleNewsSearchUrls = domains.map(domain => {
  return `https://news.google.com/search?q=site%3A${domain}%20when%3A${lookbackDays}d&hl=en-US&gl=US&ceid=US%3Aen`
})

console.log(`Generated ${googleNewsSearchUrls.length} google news search urls`);

await crawler.run(
  googleNewsSearchUrls
);