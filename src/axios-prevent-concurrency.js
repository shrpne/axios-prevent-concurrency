/// <reference path="./axios-prevent-concurrency.d.ts" />
/// <reference path="../node_modules/axios-extensions/lib/cacheAdapterEnhancer.d.ts" />
import axios from 'axios';
import buildSortedURL from 'axios-extensions/esm/utils/buildSortedURL.js';

const CANCEL_MESSAGE = 'Cancel previous request';
/**
 * list of active requests
 * @type {Object.<string, ConcurrentRequestListItem>}
 */
const activeList = {};

/**
 * Prevent concurrent request for given id. It will cancel previous request if it is pending upon new request is received. It will prevent situations when older request finishes later than new request.
 * Useful when input fires different requests and newer request always make older request obsolete, so requests are identified by ID key and not by path.
 * Must be used in front of cache adapter to work properly.
 * @param {import('axios').AxiosAdapter} adapter
 * @param {object} [options]
 * @param {boolean} [options.isCacheEnabledByDefault]
 * @return {import('axios').AxiosAdapter}
 */
export default function preventConcurrencyAdapter(adapter, options) {
    return async function(config) {
        // get request id
        const id = config.idPreventConcurrency;
        // do nothing
        if (!id) {
            return adapter(config);
        }

        const isCacheEnabled = config.cache || options.isCacheEnabledByDefault;
        const url = buildSortedURL(config.url, config.params, config.paramsSerializer);
        // do nothing for sequential duplicates, they will get response from the cache (anyway if 3rd request will come, this 2nd will be canceled with original request, because 2nd will be same as 1st cached)
        // @TODO if request lasts longer than cache time, than preventConcurrency may not work
        if (activeList[id]?.url === url && isCacheEnabled) {
            return adapter(config);
        }
        // cancel previous request if exist
        if (typeof activeList[id]?.canceler === 'function') {
            activeList[id].canceler(CANCEL_MESSAGE);
            delete activeList[id];
        }
        // save ability to cancel outgoing request
        config.cancelToken = new axios.CancelToken((canceler) => {
            activeList[id] = {url, canceler};
        });

        try {
            const result = await adapter(config);
            delete activeList[id];
            return result;
        } catch (error) {
            if (error.message === CANCEL_MESSAGE) {
                error.isCanceled = true;
            } else {
                // clean only not canceled, no need to clean for canceled request, because it was cleaned upon cancelation
                delete activeList[id];
            }
            throw error;
        }
    };
}

/**
 * @typedef {object} ConcurrentRequestListItem
 * @property {string} url - url of active request
 * @property {function|import('axios').Canceler} [canceler] - cancel previous request to keep only one active
 */
