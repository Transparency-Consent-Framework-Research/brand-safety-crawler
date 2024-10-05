import { Dataset } from 'crawlee';

export const getDataset = async () => {
    return await Dataset.open('crawl');
}

export const getFailuresDataset = async () => {
    return await Dataset.open('failures');
}

export const exportDataset = async (datasetKey: string) => {
    const dataset = await Dataset.open(datasetKey);
    await dataset.exportToCSV(`${datasetKey}-export`);
    console.log(`Saving file to /storage/key_value_stores/default/${datasetKey}-export.csv`);
}