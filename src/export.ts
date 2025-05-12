import { exportDataset } from './data.js';

console.log('Exporting dataset...');
//@ts-ignore
exportDataset('crawl-c').then(() => {
    console.log('Dataset exported');
    process.exit(0);
});