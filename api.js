const axios = require('axios');
const logger = require('./logger');
const { v4: uuidv4 } = require('uuid');

let apiToken = null;

async function fetchNewToken() {
    const timestamp = Date.now();
    const url = `https://sapi.dramaboxdb.com/drama-box/api/001/bootstrap?timestamp=${timestamp}`;

    const payload = { distinctId: "JRtf9xfdKK" };

    const headers = {
        'Host': 'sapi.dramaboxdb.com',
        'Version': '4.3.0',
        'Cid': 'DAUAG10502',
        'Package-Name': 'com.storymatrix.dramabox',
        'Apn': '2',
        'Device-Id': uuidv4(),
        'Android-Id': 'ffffffff83e731000000000000000000',
        'Language': 'en',
        'Current-Language': 'en',
        'P': '43',
        'Content-Type': 'application/json; charset=UTF-8',
        'User-Agent': 'okhttp/4.12.0'
    };

    try {
        logger.info('Fetching new API token...');
        const resp = await axios.post(url, payload, { headers });

        if (resp.data?.data?.token) {
            apiToken = resp.data.data.token;
            logger.info('Token successfully fetched and cached');
            return apiToken;
        }
        throw new Error('Failed to get token');
    } catch (err) {
        logger.error(err, 'Failed to fetch new token');
        throw err;
    }
}

async function fetchDramaBoxPage(bookId, index = 0, retries = 3) {
    if (!apiToken) await fetchNewToken();

    const timestamp = Date.now();
    const url = `https://sapi.dramaboxdb.com/drama-box/chapterv2/batch/load?timestamp=${timestamp}`;

    const payload = {
        boundaryIndex: 0,
        comingPlaySectionId: -1,
        index: index,
        currencyPlaySource: "ssym_lxjg",
        needEndRecommend: 0,
        currencyPlaySourceName: "DramaBox",
        preLoad: false,
        rid: '',
        pullCid: '',
        loadDirection: 0,
        startUpKey: "DRA1000042",
        bookId: bookId
    };

    const headers = {
        'Host': 'sapi.dramaboxdb.com',
        'Tn': `Bearer ${apiToken}`,
        'Version': '4.3.0',
        'Vn': '4.3.0',
        'Cid': 'DAUAG10502',
        'Package-Name': 'com.storymatrix.dramabox',
        'Apn': '2',
        'Device-Id': uuidv4(),
        'Android-Id': 'ffffffff83e731000000000000000000',
        'Language': 'en',
        'Current-Language': 'en',
        'P': '43',
        'Store-Source': 'store_google',
        'Nchid': 'DAUAG10502',
        'Locale': 'en_US',
        'Country-Code': 'ID',
        'Sn': '6By45Aw45y',
        'Active-Time': Date.now().toString(),
        'Content-Type': 'application/json; charset=UTF-8',
        'Accept-Encoding': 'gzip, deflate',
        'User-Agent': 'okhttp/4.12.0'
    };

    try {
        const resp = await axios.post(url, payload, { headers });

        if (resp.data?.code === 401 || resp.data?.code === 403) {
            if (retries > 0) {
                apiToken = null;
                logger.info(`Auth error (401/403). Retrying... (${retries} left)`);
                return await fetchDramaBoxPage(bookId, index, retries - 1);
            }
            throw new Error('Authentication failed after multiple retries');
        }

        return resp.data;
    } catch (err) {
        if (err.response && (err.response.status === 401 || err.response.status === 403) && retries > 0) {
            apiToken = null;
            return await fetchDramaBoxPage(bookId, index, retries - 1);
        }
        logger.error(err, `Failed to fetch page for bookId: ${bookId}, index: ${index}`);
        throw err;
    }
}

async function fetchAllDramaData(bookId) {
    logger.info(`Starting full chapter fetch for bookId: ${bookId}`);

    let firstPage = await fetchDramaBoxPage(bookId, 0);

    if (!firstPage?.data?.chapterList) {
        throw new Error('No chapter list found in initial response');
    }

    const { chapterCount } = firstPage.data;
    const chapterMap = new Map();

    firstPage.data.chapterList.forEach(ch => {
        chapterMap.set(ch.chapterId, ch);
    });

    let maxChapterIndex = Math.max(...Array.from(chapterMap.values()).map(ch => ch.chapterIndex || 0));

    while (chapterMap.size < chapterCount) {
        const nextIndex = maxChapterIndex + 40;   // batch size approx

        if (nextIndex > chapterCount + 200) {
            logger.warn('Breaking fetch loop to prevent infinite recursion.');
            break;
        }

        logger.info(`Fetching more chapters at index: ${nextIndex} for bookId: ${bookId}`);

        const nextPage = await fetchDramaBoxPage(bookId, nextIndex);

        if (nextPage?.data?.chapterList?.length) {
            nextPage.data.chapterList.forEach(ch => {
                chapterMap.set(ch.chapterId, ch);
            });

            const newMax = Math.max(...Array.from(chapterMap.values()).map(ch => ch.chapterIndex || 0));
            if (newMax <= maxChapterIndex) break;
            maxChapterIndex = newMax;
        } else {
            break;
        }
    }

    const sortedChapters = Array.from(chapterMap.values())
        .sort((a, b) => (a.chapterIndex || 0) - (b.chapterIndex || 0));

    logger.info(`Successfully fetched \( {sortedChapters.length}/ \){chapterCount} chapters for bookId: ${bookId}`);

    return {
        ...firstPage.data,
        chapterList: sortedChapters
    };
}

module.exports = { fetchAllDramaData };
