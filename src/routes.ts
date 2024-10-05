//@ts-nocheck
import { createPlaywrightRouter } from 'crawlee';
import { getDataset } from './data.js';

export const router = createPlaywrightRouter();

const dataset = await getDataset();

// Simple counter to keep track of good results
let good = 0;

router.addDefaultHandler(async ({ log, page, request, session }) => {

    const title = await page.title();
    const url = new URL(request.loadedUrl);

    // Wait for the googletag object to be available
    // await page.waitForFunction(() => window.googletag && googletag.pubads, { timeout: 10000 });

    const targeting = await page.evaluate(async () => {
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

    if(Object.keys(targeting.page).length === 0 && Object.keys(targeting.slot).length === 0) {
        log.error('No targeting keys found', {
            url: request.loadedUrl
        });
        session?.markBad();
    } else {
        good++;
        log.info(`[${good}] ${title}`, {
            keys: Object.keys(targeting).length,
            url: request.loadedUrl
        });

        session?.markGood();

        const hostnameNoWWW = url.hostname.replace('www.', '');

        await dataset.pushData({
            hostname: hostnameNoWWW,
            url: request.loadedUrl,
            title,
            page: targeting.page,
            slot: targeting.slot
        });
    }

});
