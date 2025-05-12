//@ts-nocheck
import { createPlaywrightRouter } from 'crawlee';
import dayjs from "dayjs";
import { get, list, has } from 'wild-wild-path';
import { map } from 'wild-wild-utils';
import { getDataset, getPrebidDataset } from './data.js';
import { randomUUID } from 'node:crypto';

export const router = createPlaywrightRouter();

// Load datasets for storing crawl results
const dataset = await getDataset();
const prebidDataset = await getPrebidDataset();

// Types of bid response events to track
const bidResponseTypes = ['bidResponse', 'bidAccepted', 'bidWon', 'bidAdjustment'];

// Simple counter to keep track of successful crawls
let good = 0;

// --- Helper: Extract auction initialization data from events ---
function extractAuctionInitData(events) {
    return events
        .filter(event => event.eventType === 'auctionInit')
        .reduce((auctionBids, event) => {
            const auctionId = event.args.auctionId;
            const bidRequests = list(event, 'args.bidderRequests.*.bids.*');
            bidRequests.forEach(bid => {
                const adUnitCode = bid.adUnitCode;
                const bidId = bid.bidId || bid.bid_id;
                auctionBids[auctionId] = auctionBids[auctionId] || {};
                auctionBids[auctionId][adUnitCode] = auctionBids[auctionId][adUnitCode] || {};
                auctionBids[auctionId][adUnitCode][bidId] = {
                    auction_id: auctionId,
                    ad_unit_code: adUnitCode,
                    ad_unit_gpid: bid.ortb2Imp?.ext?.gpid,
                    bid_id: bidId,
                    context: event.context,
                    wrapper: event.wrapper,
                    bidder_code: bid.bidder,
                    media_types: bid.mediaTypes,
                    ortb2imp: bid.ortb2Imp,
                    advertiser_domains: [],
                    cpm: null,
                    media_type: null,
                    timestamp: event.args.timestamp,
                };
            });
            return auctionBids;
        }, {});
}

// --- Helper: Merge auction bids with bid response events ---
function mergeAuctionBidsWithEvents(auctionBids, relevantEvents) {
    try {
        const clonedAuctionBids = structuredClone(auctionBids);
        // console.log('Merging auction bids with events...', Object.keys(auctionBids), Object.keys(clonedAuctionBids), relevantEvents.length);
        // log events with args.cpm
        // console.log('Filtered Events:', relevantEvents.filter(event => event.args.cpm));
        relevantEvents
        .filter(event => bidResponseTypes.some(type => event.eventType.includes(type)))
        .forEach(event => {
        const auctionId = event.args.auctionId;
        const adUnitCode = event.args.adUnitCode;
        const bidId = event.args.bidId || event.args.bid_id || event.args.requestId;
        //   console.log('Event:', event.eventType, auctionId, adUnitCode, bidId);
        if (
            clonedAuctionBids[auctionId] &&
            clonedAuctionBids[auctionId][adUnitCode] &&
            clonedAuctionBids[auctionId][adUnitCode][bidId]
        ) {
            const bid = clonedAuctionBids[auctionId][adUnitCode][bidId];
            bid.cpm = event.args.cpm;

            bid.media_type = event.args.mediaType || event.args.media_type || null;
            const advertiserDomains = event.args.meta?.advertiserDomains || event.args.adDomain;
            bid.advertiser_domains = Array.isArray(advertiserDomains) ? advertiserDomains : advertiserDomains;
            console.log(`  ⭐ ${adUnitCode} CPM: ${bid.cpm}`, bid.media_type);
        }
        });

        return clonedAuctionBids;
    } catch (error) {
        console.error('Error merging auction bids with events:', error);
        return auctionBids;
    }
}

// --- Helper: Denormalize merged bids for dataset ---
function denormalizeMergedBids(mergedBids, crawl_id, hostnameNoWWW, url) {
    const result = [];
    Object.entries(mergedBids).forEach(([auctionId, adUnits]) => {
        Object.entries(adUnits).forEach(([adUnitCode, bids]) => {
            Object.entries(bids).forEach(([bidId, bidData]) => {
                result.push({
                    crawl_id: crawl_id,
                    hostname: hostnameNoWWW,
                    url: url,
                    context: bidData.context,
                    wrapper: bidData.wrapper,
                    auction_id: bidData.auction_id,
                    ad_unit_code: bidData.ad_unit_code,
                    ad_unit_gpid: bidData.ad_unit_gpid,
                    bid_id: bidData.bid_id,
                    bidder_code: bidData.bidder_code,
                    media_types: Object.keys(bidData.media_types || {}),
                    ortb2imp: bidData.ortb2imp,
                    advertiser_domains: bidData.advertiser_domains,
                    cpm: bidData.cpm,
                    bid_media_type: bidData.media_type,
                    timestamp: bidData.timestamp
                });
            });
        });
    });
    return result;
}

// --- Helper: Extract GPT targeting data from the page ---
async function extractTargeting(page) {
    return await page.evaluate(async () => {
        let counter = 0;
        while (counter < 5) {
            if (window.googletag && googletag.pubads) {
                const targetKeys = googletag.pubads().getTargetingKeys();
                const targetArr = {};
                targetKeys.forEach(key => {
                    targetArr[key] = googletag.pubads().getTargeting(key);
                });
                const slots = googletag.pubads().getSlots();
                const slotArr = {};
                slots.forEach(slot => {
                    slotArr[slot.getSlotElementId()] = slot.getTargetingMap();
                });
                return {
                    page: targetArr,
                    slot: slotArr
                }
            }
            counter++;
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        return {
            page: {},
            slot: {}
        };
    });
}

async function slowScrollToBottom(
    page: Page,
    options?: {
      duration?: number;
      interval?: number;
      logProgress?: boolean;
    }
  ): Promise<void> {
    const scrollDuration = options?.duration ?? 10000; // Default 10 seconds
    const scrollInterval = options?.interval ?? 50; // Default 50ms interval
    const logProgress = options?.logProgress ?? false;
  
    const startTime = Date.now();
    if (logProgress) {
      console.log(`Starting slow scroll. Target duration: ${scrollDuration / 1000} seconds.`);
    }
  
    let iterations = 0;

    while (Date.now() - startTime < scrollDuration) {
      iterations++;
      const elapsedTime = Date.now() - startTime;
      const progress = Math.min(elapsedTime / scrollDuration, 1.0);

      const pageScrollHeight = await page.evaluate(() => document.body.scrollHeight);
      const viewportHeight = await page.evaluate(() => window.innerHeight);
      const maxScrollableY = Math.max(0, pageScrollHeight - viewportHeight);
      const targetY = progress * maxScrollableY;

      await page.evaluate((y) => {
        window.scrollTo(0, y);
      }, targetY);

      if (logProgress) {
        const currentScrollY = await page.evaluate(() => window.pageYOffset);
        console.log(
          `Time: ${elapsedTime}ms, Progress: ${(progress * 100).toFixed(2)}%, TargetY: ${targetY.toFixed(0)}, CurrentY: ${currentScrollY.toFixed(0)}, ScrollHeight: ${pageScrollHeight}`
        );
      }

      if (progress >= 1.0) {
        break;
      }
  
      await page.waitForTimeout(scrollInterval);
    }

    // Final scroll to ensure it's at the very bottom
    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
    });

    if (logProgress) {
      const endTime = Date.now();
      const actualDuration = endTime - startTime;
      const finalScrollY = await page.evaluate(() => window.pageYOffset);
      console.log(`Scroll finished. Actual duration: ${actualDuration / 1000} seconds. Final scrollY: ${finalScrollY.toFixed(2)}`);
    }
  }


// Main handler for all crawled pages
router.addDefaultHandler(async ({ log, page, request, session }) => {
    // Generate a unique crawl ID for this session
    const crawl_id = randomUUID();
    const title = await page.title();
    const url = new URL(request.loadedUrl);
    const hostnameNoWWW = url.hostname.replace('www.', '');

    console.log(`Loaded ${request.loadedUrl}...`);

    // --- Wait for ad events to be emitted ---
    await Promise.all([
        page.waitForTimeout(20000),
        slowScrollToBottom(page, {
            duration: 15000, // Scroll over 10 seconds
            interval: 100,     // Update scroll position every 50ms
            logProgress: false // Log progress to the console
        })
    ]);
    console.log('20 seconds passed, checking for targeting data...');

    // --- Extract auction data from the request user data ---
    const bidData = [];
    const eventsInFrames = request.userData.events;
    for(const frameId in eventsInFrames) {
        console.log(`Processing events for frame: ${frameId}`);
        const events = eventsInFrames[frameId];
        const auctionBids = extractAuctionInitData(events);
        const mergedBids = mergeAuctionBidsWithEvents(auctionBids, events);
        const denormalizedAuctionData = denormalizeMergedBids(mergedBids, crawl_id, hostnameNoWWW, request.loadedUrl);
        bidData.push(...denormalizedAuctionData);
    }

    // we need to deduplicate bidData by bid_id
    const uniqueBidData = [];
    const seenBidIds = new Set();
    bidData.forEach(bid => {
        if (!seenBidIds.has(bid.bid_id)) {
            seenBidIds.add(bid.bid_id);
            uniqueBidData.push(bid);
        }
    });
    const dedupedBidData = [];
    dedupedBidData.push(...uniqueBidData);
    console.log(`Unique bid data length: ${bidData.length}/${dedupedBidData.length} Uniques`);

    // --- Extract Google Publisher Tag (GPT) targeting data from the page ---
    const targeting = await extractTargeting(page);

    // --- Handle case: No targeting data found ---
    if (Object.keys(targeting.page).length === 0 && Object.keys(targeting.slot).length === 0) {
        log.error('No targeting keys found', {
            url: request.loadedUrl
        });
        session?.markBad();
        await dataset.pushData({
            crawl_id,
            hostname: hostnameNoWWW,
            url: request.loadedUrl,
            targeting_data: false,
            title,
            page: {},
            slot: {}
        });
        await prebidDataset.pushData({
            crawl_id,
            hostname: hostnameNoWWW,
            url: request.loadedUrl,
            targeting_data: false,
            bids: [],
        });
    } else {
        // --- Handle case: Targeting data found ---
        session?.markGood();
        good++;

 
        await dataset.pushData({
            crawl_id,
            hostname: hostnameNoWWW,
            url: request.loadedUrl,
            targeting_data: true,
            title,
            page: targeting.page,
            slot: targeting.slot
        });

        await prebidDataset.pushData(bidData);

        log.info(`[${good}] ${title}`, {
            url: request.loadedUrl,
            bidLen: bidData.length,
            targetingLen: Object.keys(targeting.page).length,
        });
    }
});
