import { PlaywrightCrawler, ProxyConfiguration, RequestQueue } from 'crawlee';
import { router } from './routes.js';
import { articles } from './articles.json';
import { getFailuresDataset } from './data.js';
import { ensureHttps } from "./util.js";
import { CONSTANTS } from './constants.js';

const articlesShuffled = articles.sort(() => Math.random() - 0.5);

const failuresDataset = await getFailuresDataset();
const crawlQueue = await RequestQueue.open('crawl-queue');

const crawler = new PlaywrightCrawler({
    proxyConfiguration: new ProxyConfiguration({ proxyUrls: CONSTANTS.PROXY_URLS }),
    useSessionPool: true,
    persistCookiesPerSession: true,
    requestQueue: crawlQueue,
    requestHandler: router,
    launchContext: {
        useChrome: true,
    },
    sessionPoolOptions: {
        maxPoolSize: 30
    },
    maxConcurrency: 3,
    maxRequestRetries: 10,
    failedRequestHandler: async ({ request, log }) => {
        log.error(`🔺 Request ${request.url} failed`);
        const url = new URL(request.url);
        const hostnameNoWWW = url.hostname.replace('www.', '');

        await failuresDataset.pushData({
            hostname: hostnameNoWWW,
            url: request.url,
        });
    }
});

console.log(`Crawling ${articlesShuffled.length} articles...`);

await crawler.run(
    articlesShuffled.map(ensureHttps)
);
