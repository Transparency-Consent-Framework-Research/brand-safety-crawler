//@ts-nocheck
import { PlaywrightCrawler, ProxyConfiguration, RequestQueue } from 'crawlee';
import { router } from './routes.js';
import { articles } from './articles_25.json';
import { getFailuresDataset } from './data.js';
import { ensureHttps } from "./util.js";
// import { CONSTANTS } from './constants.js';

console.log('Starting crawler...');

// const articlesShuffled = articles.sort(() => Math.random() - 0.5); // Uncomment this to shuffle articles

const failuresDataset = await getFailuresDataset();
const crawlQueue = await RequestQueue.open('crawl-queue-25-run');

const crawler = new PlaywrightCrawler({
    // proxyConfiguration: new ProxyConfiguration({ proxyUrls: CONSTANTS.PROXY_URLS }),
    useSessionPool: true,
    persistCookiesPerSession: true,
    // requestQueue: crawlQueue, // Uncomment this to enable request queue
    requestHandler: router,
    launchContext: {
        useChrome: true,
        launchOptions: {
            args: [
                '--disable-blink-features=AutomationControlled',
                '--disable-web-security',
            ]
        }
    },
    sessionPoolOptions: {
        maxPoolSize: 30
    },
    preNavigationHooks: [
        async (crawlingContext, gotoOptions) => {
            gotoOptions.waitUntil = 'domcontentloaded';
            const { page } = crawlingContext;
            console.log('PreNavigationHook: ', crawlingContext.request.url);
            const auctions = {};
            await page.setViewportSize({
                width: 1920,
                height: 1080
            });

            crawlingContext.request.userData.calls = 0;
            crawlingContext.request.userData.events = {};

            await page.exposeBinding('pbdddd', async ({ frame }, value) => {
                crawlingContext.request.userData.calls++;
                const frameId = frame._guid;
                const isChildFrame = !!frame.parentFrame();
                const wrapper = value.wrapper;
                crawlingContext.request.userData.events[frameId] = value.events.map(event => {,
                    return {
                        ...event,
                        wrapper: wrapper,
                        frameId: frameId,
                        context: isChildFrame ? 'child' : 'top',
                    }
                });

            });

            await page.addInitScript(async () => {
                setInterval(function () {
                    try {
                        if (window._pbjsGlobals && Array.isArray(window._pbjsGlobals)) {
                            console.log('Prebid.js globals found:', window._pbjsGlobals);
                            window._pbjsGlobals.forEach(name => {
                                window.pbdddd({
                                    wrapper: name,
                                    installed_modules: window[name].installedModules,
                                    consent_metadata: typeof window[name].getConsentMetadata === 'function' ? window[name].getConsentMetadata() : {},
                                    config: typeof window[name].getConfig === 'function' ? window[name].getConfig() : {},
                                    version: window[name].version,
                                    user_ids: typeof window[name].getUserIds === 'function' ? window[name].getUserIds() : [],
                                    targeting: typeof window[name].getAllTargeting === 'function' ? window[name].getAdserverTargeting() : {},
                                    events: typeof window[name].getEvents === 'function' ? window[name].getEvents() : [],
                                });
                            });
                        }
                    } catch (e) {
                        console.log('Error in Prebid.js globals:', e);
                    }
                }, 1000);
            });
        }
    ],
    maxConcurrency: 2,
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

// UNCOMMENT THIS TO ENABLE REQUEST QUEUE
// console.log(`Crawling ${articlesShuffled.length} articles...`);

await crawler.run(
    // articlesShuffled.map(ensureHttps)
    ['https://pagesix.com/2025/05/02/celebrity-news/hugh-hefners-widow-crystal-hefner-engaged-to-james-ward/']
);
