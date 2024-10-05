import { exportDataset } from './data.js';

console.log('Exporting dataset...');
exportDataset().then(() => {
    console.log('Dataset exported');
    process.exit(0);
});