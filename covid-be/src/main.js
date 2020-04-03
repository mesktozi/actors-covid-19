// main.js
const Apify = require('apify');
const XLSX = require('xlsx')
const { log } = Apify.utils;

const LATEST = "LATEST";
const now = new Date();
const sourceUrl = 'https://epistat.wiv-isp.be/Covid';

Apify.main(async () => {

    log.info('Starting actor.');

    const kvStore = await Apify.openKeyValueStore("COVID-19-Belgium");
    const dataset = await Apify.openDataset("COVID-19-Belgium-HISTORY");
    // const store = await Apify.openKeyValueStore('my-store');

    const requestQueue = await Apify.openRequestQueue();

    await requestQueue.addRequest({
        url: 'https://epistat.wiv-isp.be/covid',
        userData: {
            label: 'GET_XLSX_LINK'
        }
    })

    log.debug('Setting up crawler.');
    const cheerioCrawler = new Apify.CheerioCrawler({
        requestQueue,
        maxRequestRetries: 5,
        useApifyProxy: true,
        additionalMimeTypes: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'text/plain'],
        prepareRequestFunction: async ({ request }) => {
            if (request.url.endsWith('.xlsx')) {
                log.info(`Proccecing ${request.url}`)
                log.info(`Downloading xlsx file ...`)
            };
        },
        handlePageFunction: async ({ request, $, body }) => {
            const { label } = request.userData;
            switch (label) {
                case 'GET_XLSX_LINK':
                    log.info(`Proccecing ${request.url}`)
                    log.info(`Getting xlsx download link.`)
                    const $xlsxLink = $("#Data li").first().find('a').attr('href');
                    await requestQueue.addRequest({
                        url: $xlsxLink,
                        userData: {
                            label: 'EXTRACT_DATA'
                        }
                    })
                    break;
                case 'EXTRACT_DATA':
                    log.info(`File had downloaded.`);
                    log.info(`Processing and saving data.`);
                    let workbook = XLSX.read(body, { type: "buffer" });

                    const { ModifiedDate } = workbook.Props;
                    const atSource = new Date(ModifiedDate)

                    const CASES_AGESEX = XLSX.utils.sheet_to_json(workbook.Sheets['CASES_AGESEX']),
                        CASES_MUNI = XLSX.utils.sheet_to_json(workbook.Sheets['CASES_MUNI']),
                        CASES_MUNI_CUM = XLSX.utils.sheet_to_json(workbook.Sheets['CASES_MUNI_CUM']),
                        HOSP = XLSX.utils.sheet_to_json(workbook.Sheets['HOSP']),
                        MORT = XLSX.utils.sheet_to_json(workbook.Sheets['MORT']),
                        TESTS = XLSX.utils.sheet_to_json(workbook.Sheets['TESTS']);

                    const data = {}

                    data.infected = await getSheetColumnSum(CASES_AGESEX, 'CASES') || 'N/A';
                    data.tasted = await getSheetColumnSum(TESTS, 'TESTS') || 'N/A';
                    data.recovered = 'N/A';
                    data.deaths = await getSheetColumnSum(MORT, 'DEATHS') || null;
                    data.totalInToHospital = await getSheetColumnSum(HOSP, 'TOTAL_IN');
                    data.totalHospitalized = await getSheetColumnSum(HOSP, 'NEW_IN');
                    data.newlyOutOfHospital = await getSheetColumnSum(HOSP, 'NEW_OUT');

                    data.country = 'Belgium';
                    data.historyData = 'ttps://api.apify.com/v2/datasets/Up9jPMxFfTl9twVGM/items?format=json&clean=1.';
                    data.sourceUrl = sourceUrl;
                    data.lastUpdatedAtApify = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), now.getMinutes())).toISOString();
                    data.lastUpdatedAtSource = new Date(Date.UTC(atSource.getFullYear(), atSource.getMonth(), atSource.getDate(), (atSource.getHours()), atSource.getMinutes())).toISOString();
                    data.readMe = 'https://apify.com/onidivo/covid-be';

                    // Push the data
                    let latest = await kvStore.getValue(LATEST);
                    if (!latest) {
                        await kvStore.setValue('LATEST', data);
                        latest = data;
                    }
                    delete latest.lastUpdatedAtApify;
                    const actual = Object.assign({}, data);
                    delete actual.lastUpdatedAtApify;

                    if (JSON.stringify(latest) !== JSON.stringify(actual)) {
                        await dataset.pushData(data);
                    }
                    await kvStore.setValue('LATEST', data);
                    await Apify.pushData(data);
                    log.info('Data saved.');
                    break;
                default:
                    break;
            }

        },
        handleFailedRequestFunction: async ({ request }) => {
            console.log(`Request ${request.url} failed many times.`);
            console.dir(request)
        },
    });
    // Run the crawler and wait for it to finish.
    log.info('Starting the crawl.');
    await cheerioCrawler.run();
    log.info('Actor finished.');
});

async function getSheetColumnSum(sheet, column) {
    return sheet.reduce((prev, cur) => {
        return prev + cur[column];
    }, 0);
}

