//@ts-nocheck
import { PlaywrightCrawler, ProxyConfiguration, RequestQueue } from 'crawlee';
import { router } from './routes.js';
import { articles } from './articles_test_antonio.json';
import { getFailuresDataset } from './data.js';
import { ensureHttps } from "./util.js";
// import { CONSTANTS } from './constants.js';

console.log('Starting crawler... 111');

// const articlesShuffled = articles.sort(() => Math.random() - 0.5); // Uncomment this to shuffle articles

const failuresDataset = await getFailuresDataset();
const crawlQueue = await RequestQueue.open('crawl-queue-25-run-c');

const crawler = new PlaywrightCrawler({
    // proxyConfiguration: new ProxyConfiguration({ proxyUrls: CONSTANTS.PROXY_URLS }),
    useSessionPool: true,
    persistCookiesPerSession: true,
    requestQueue: crawlQueue, // Uncomment this to enable request queue
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

            function shallowCopyByDepth(source, maxDepth, currentDepth = 0) {
                // 1. Handle non-serializable types or things we don't want to copy deeply
                if (typeof source === 'function') {
                    return '[Function Omitted]'; // Or undefined, or null
                }
                if (typeof source !== 'object' || source === null) {
                    return source; // Primitives (string, number, boolean, null, undefined, symbol)
                }
            
                // 2. Check if we've reached the maximum depth
                if (currentDepth >= maxDepth) {
                    // If it's an array or object at max depth, decide what to return.
                    // Option A: A simple placeholder
                    // return Array.isArray(source) ? '[Array Max Depth]' : '[Object Max Depth]';
                    // Option B: An empty version of itself (might be safer if downstream code expects an object/array)
                    // return Array.isArray(source) ? [] : {};
                    // Option C: (More advanced) Just its primitive properties if it's an object
                    if (Array.isArray(source)) return []; // Or a placeholder like "[Array Truncated]"
                    const shallowObj = {};
                    for (const key in source) {
                        if (Object.prototype.hasOwnProperty.call(source, key)) {
                            if (typeof source[key] !== 'object' && typeof source[key] !== 'function') {
                                shallowObj[key] = source[key];
                            }
                        }
                    }
                    return shallowObj; // Returns only primitive properties at max depth
                }
            
                // 3. If it's an array, map over its elements and recursively copy
                if (Array.isArray(source)) {
                    const newArray = [];
                    for (let i = 0; i < source.length; i++) {
                        newArray[i] = shallowCopyByDepth(source[i], maxDepth, currentDepth + 1);
                    }
                    return newArray;
                }
            
                // 4. If it's an object, iterate over its keys and recursively copy values
                const newObject = {};
                for (const key in source) {
                    if (Object.prototype.hasOwnProperty.call(source, key)) {
                        newObject[key] = shallowCopyByDepth(source[key], maxDepth, currentDepth + 1);
                    }
                }
                return newObject;
            }

            await page.exposeBinding('pbdddd', async ({ frame }, value) => {
                crawlingContext.request.userData.calls++;
                const frameId = frame._guid;
                const isChildFrame = !!frame.parentFrame();
                const wrapper = value.wrapper;
                crawlingContext.request.userData.events[frameId] = value.events.map(event => {
                    return {
                        ...shallowCopyByDepth(event, 7),
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
                                    // installed_modules: window[name].installedModules,
                                    // consent_metadata: typeof window[name].getConsentMetadata === 'function' ? window[name].getConsentMetadata() : {},
                                    // config: typeof window[name].getConfig === 'function' ? window[name].getConfig() : {},
                                    version: window[name].version,
                                    // user_ids: typeof window[name].getUserIds === 'function' ? window[name].getUserIds() : [],
                                    // targeting: typeof window[name].getAllTargeting === 'function' ? window[name].getAdserverTargeting() : {},
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
        // const url = new URL(request.url);
        // const hostnameNoWWW = url.hostname.replace('www.', '');

        // await failuresDataset.pushData({
        //     hostname: hostnameNoWWW,
        //     url: request.url,
        // });
    }
});

// UNCOMMENT THIS TO ENABLE REQUEST QUEUE
// console.log(`Crawling ${articlesShuffled.length} articles...`);

await crawler.run(
    articles.map(ensureHttps)
    // ['https://pagesix.com/2025/05/02/celebrity-news/hugh-hefners-widow-crystal-hefner-engaged-to-james-ward/']
);
