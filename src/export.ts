import { exportDataset } from './data.js';

console.log('Exporting dataset...');
//@ts-ignore
exportDataset('crawl25').then(() => {
    console.log('Dataset exported');
    process.exit(0);
});