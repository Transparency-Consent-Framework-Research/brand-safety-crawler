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
    const clonedAuctionBids = JSON.parse(JSON.stringify(auctionBids));
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
        console.log(event.args)
        const bid = clonedAuctionBids[auctionId][adUnitCode][bidId];
        bid.cpm = event.args.cpm;

        bid.media_type = event.args.mediaType || event.args.media_type || null;
        const advertiserDomains = event.args.meta?.advertiserDomains || event.args.adDomain;
        bid.advertiser_domains = Array.isArray(advertiserDomains) ? advertiserDomains : advertiserDomains;
        console.log(`  ⭐ ${adUnitCode} CPM: ${bid.cpm}`, bid.width, bid.height, bid.media_type);
      }
    });

    return clonedAuctionBids;
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

// Main handler for all crawled pages
router.addDefaultHandler(async ({ log, page, request, session }) => {
    // Generate a unique crawl ID for this session
    const crawl_id = randomUUID();
    const title = await page.title();
    const url = new URL(request.loadedUrl);
    const hostnameNoWWW = url.hostname.replace('www.', '');

    console.log(`Loaded ${request.loadedUrl}...`);

    // --- Wait for ad events to be emitted ---
    await page.waitForTimeout(20000); // 20 seconds
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
