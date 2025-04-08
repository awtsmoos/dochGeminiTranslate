// B"H

import http from 'http';
import https from 'https';
import { URL } from 'url';
// Use Node's built-in WHATWG Stream implementation
import { ReadableStream } from 'stream/web';
import { Buffer } from 'buffer'; // Explicit import might be needed in some environments

const MAX_REDIRECTS = 10;

// --- FetchHeaders Class (Mostly Unchanged) ---
// Using the existing FetchHeaders class as it's reasonably spec-compliant
class FetchHeaders {
    #headers = new Map(); // Use a Map to preserve insertion order and handle case

    constructor(init) {
        if (init instanceof FetchHeaders) {
            // Copy constructor
            init.forEach((value, key) => {
                this.append(key, value);
            });
        } else if (Array.isArray(init)) {
            // Array of [key, value] pairs
            init.forEach(([key, value]) => {
                this.append(String(key), String(value));
            });
        } else if (init && typeof init === 'object') {
            // Plain object or Node's http.IncomingHttpHeaders
            // Node's headers might have string[] for multi-value like set-cookie
            Object.entries(init).forEach(([key, value]) => {
                if (Array.isArray(value)) {
                    value.forEach(v => this.append(String(key), String(v)));
                } else {
                    this.append(String(key), String(value));
                }
            });
        } else if (init != null) {
            throw new TypeError("Failed to construct 'Headers': The provided value is not of type '(sequence<sequence<ByteString>> or record<ByteString, ByteString>)'");
        }
    }

    #normalizeKey(name) {
        return String(name).toLowerCase();
    }

     #normalizeValue(value) {
        return String(value).trim();
    }

    append(name, value) {
        const key = this.#normalizeKey(name);
        const normValue = this.#normalizeValue(value);
        const existing = this.#headers.get(key);
        if (existing) {
             if (Array.isArray(existing.value)) {
                 existing.value.push(normValue);
            } else {
                 existing.value = [existing.value, normValue];
            }
        } else {
             this.#headers.set(key, { originalName: String(name), value: normValue });
        }
    }

    delete(name) {
        this.#headers.delete(this.#normalizeKey(name));
    }

    get(name) {
        const entry = this.#headers.get(this.#normalizeKey(name));
        if (!entry) return null;
         if (Array.isArray(entry.value)) {
              // Spec says join with ", " EXCEPT for Set-Cookie
             if (key === 'set-cookie') {
                  // This basic impl still joins, browser Headers doesn't.
                  // A more compliant impl would return null here and require getSetCookie().
                  console.warn("Fetching Set-Cookie via get() with multiple values is non-standard. Consider iterating or a dedicated method.");
                  return entry.value.join(', '); // Non-standard but simple here
             }
             return entry.value.join(', ');
         }
         return entry.value;
    }

    // Required for spec compliance, especially Set-Cookie
    getSetCookie() {
        const entry = this.#headers.get('set-cookie');
        if (!entry) return [];
        return Array.isArray(entry.value) ? entry.value : [entry.value];
    }


    has(name) {
        // Special case for Set-Cookie? The spec is nuanced. has('Set-Cookie') should work.
        return this.#headers.has(this.#normalizeKey(name));
    }

    set(name, value) {
        const key = this.#normalizeKey(name);
        const normValue = this.#normalizeValue(value);
        this.#headers.set(key, { originalName: String(name), value: normValue });
    }

    forEach(callback, thisArg) {
        for (const [key, entry] of this.#headers.entries()) {
            const value = this.get(entry.originalName);
            callback.call(thisArg, value, entry.originalName, this);
        }
    }

    *entries() {
        for (const [key, entry] of this.#headers.entries()) {
             const value = this.get(entry.originalName);
             yield [entry.originalName, value];
        }
    }
    *keys() {
         for (const entry of this.#headers.values()) {
             yield entry.originalName;
        }
    }
    *values() {
        for (const entry of this.#headers.values()) {
             const value = this.get(entry.originalName);
             yield value;
        }
    }
    [Symbol.iterator]() {
        return this.entries();
    }

    _getNodeHeaders() {
        const nodeHeaders = {};
        this.forEach((value, name) => {
             const key = this.#normalizeKey(name);
             const internalEntry = this.#headers.get(key);
             // Pass array for multi-values if Node http module expects it (like set-cookie)
             if (Array.isArray(internalEntry.value)) {
                 nodeHeaders[key] = internalEntry.value;
             } else {
                  nodeHeaders[key] = value;
             }
        });
        return nodeHeaders;
    }
}


// --- FetchResponse Class (Rewritten for Streaming Body) ---
class FetchResponse {
    #nodeStream; // The underlying Node.js IncomingMessage stream
    #body; // The WHATWG ReadableStream instance
    #disturbed = false; // Tracks if the body stream has been accessed (read from or reader obtained)
    #url = '';
    #status = 0;
    #statusText = '';
    #headers = null;
    #redirected = false;

    // Constructor no longer buffers, just sets up metadata and the stream bridge
    constructor(nodeResponse, url, redirected) {
        this.#nodeStream = nodeResponse; // Keep the Node stream reference
        this.#url = url;
        this.#status = nodeResponse.statusCode;
        this.#statusText = nodeResponse.statusMessage;
        this.#headers = new FetchHeaders(nodeResponse.headers); // Use our Headers class
        this.#redirected = redirected;

        // Create the WHATWG ReadableStream adapter for the Node stream
        // We do this immediately so response.body is always available.
        this.#body = this.#createReadableStreamFromNodeStream();

        // NOTE: The constructor is now synchronous. The outer fetch promise
        // resolves as soon as headers are available.
    }

     #createReadableStreamFromNodeStream() {
        // If the stream is already ended or errored (e.g., empty body), handle it.
        // This is slightly tricky, as the events might fire *after* the constructor.
        // It's generally safer to let the stream events handle this.

        const nodeStream = this.#nodeStream;
        let destroyed = false;

        return new ReadableStream({
            start: (controller) => {
                nodeStream.on('data', (chunk) => {
                    // Node chunks are Buffers, WHATWG Streams expect Uint8Array
                    // We enqueue a *copy* to be safe, as Buffers can be mutable views
                     try {
                       controller.enqueue(new Uint8Array(chunk));
                     } catch (e) {
                        // Handle potential error if stream closed during enqueue
                        console.error("Error enqueuing chunk:", e);
                        this.#destroyNodeStream(nodeStream, controller, e);
                     }
                });

                nodeStream.on('end', () => {
                     if (!destroyed) {
                        try {
                            controller.close();
                        } catch (e) {
                            console.error("Error closing stream:", e);
                            // Controller might already be in error state
                        }
                        destroyed = true;
                     }
                });

                nodeStream.on('error', (err) => {
                    this.#destroyNodeStream(nodeStream, controller, err);
                });

                 // Handle cases where the stream might have been prematurely closed/aborted
                 // before we attached listeners (less common for server responses but possible)
                 nodeStream.on('aborted', () => {
                      this.#destroyNodeStream(nodeStream, controller, new Error("Stream aborted"));
                 });
                 nodeStream.on('close', () => {
                      // This often fires *after* end or error. Ensure we only close/error once.
                      if (!destroyed) {
                           this.#destroyNodeStream(nodeStream, controller, new Error("Stream closed unexpectedly"));
                      }
                 });

            },
            pull: (controller) => {
                // Node streams generally push data automatically when available.
                // We might need `nodeStream.resume()` if it was paused due to backpressure,
                // but the ReadableStream implementation often handles this implicitly.
                // For simplicity, we can leave this empty for http.IncomingMessage.
                // nodeStream.resume(); // Might be needed in some backpressure scenarios
            },
            cancel: (reason) => {
                // Called by the consumer if they want to stop reading the stream.
                this.#disturbed = true; // Mark as disturbed on cancel as well
                if (!destroyed) {
                    nodeStream.destroy(reason instanceof Error ? reason : new Error(String(reason ?? 'Stream cancelled')));
                    destroyed = true;
                }
            }
        });
    }

    #destroyNodeStream(nodeStream, controller, error) {
        if (!this.destroyed) {
            this.destroyed = true;
            try {
                // Attempt to signal the error to the ReadableStream consumer
                // This might fail if the controller is already closed or errored.
                controller.error(error);
            } catch (e) {
                // Ignore errors trying to signal an already closed/errored stream
            }
            // Ensure the underlying Node stream is destroyed to release resources
            if (!nodeStream.destroyed) {
                nodeStream.destroy(error);
            }
        }
    }


    // --- Response Metadata (Unchanged) ---
    get headers() {
        return this.#headers;
    }
    get ok() {
        return this.#status >= 200 && this.#status < 300;
    }
    get redirected() {
        return this.#redirected;
    }
    get status() {
        return this.#status;
    }
    get statusText() {
        return this.#statusText;
    }
    get url() {
        return this.#url;
    }

    // --- Body Property ---
    get body() {
        return this.#body;
    }

    get bodyUsed() {
        // The WHATWG stream itself tracks locking (`this.#body.locked`),
        // but `bodyUsed` in the spec means disturbed *or* locked.
        // We mark as disturbed when consumption starts (via getReader or methods below)
        return this.#disturbed || this.#body.locked;
    }

    // --- Body Reading Methods (Consume the Stream) ---

    // Internal helper to read the stream fully
    async #consumeBodyStream() {
        if (this.bodyUsed) {
             // Check bodyUsed *before* potentially locking the stream again
            throw new TypeError('Body already used or locked');
        }
        this.#disturbed = true; // Mark as disturbed now

        const reader = this.#body.getReader();
        const chunks = [];
        let totalLength = 0;

        try {
            while (true) {
                const { done, value } = await reader.read(); // value is Uint8Array here
                if (done) {
                    break;
                }
                chunks.push(Buffer.from(value)); // Convert Uint8Array back to Buffer for concat
                totalLength += value.byteLength;
            }
        } finally {
            // Ensure the lock is released even if an error occurs during read loop
            // Though spec says stream is consumed, releasing helps if error happened mid-read.
            // reader.releaseLock(); // releaseLock() is implicit when done=true or error
        }


        // Concatenate Node Buffers, which is efficient
        return Buffer.concat(chunks, totalLength);
    }


    async text() {
        const buffer = await this.#consumeBodyStream();
        // Try to determine encoding from Content-Type, default to utf-8
        const contentType = this.headers.get('content-type') || '';
        const charsetMatch = contentType.match(/charset=([^;]+)/);
        const encoding = charsetMatch ? charsetMatch[1].trim().toLowerCase() : 'utf-8';

        try {
            // Use Buffer's toString with detected or default encoding
            return buffer.toString(encoding);
        } catch (e) {
            if (e.message.includes('Unknown encoding')) { // Check if error is due to encoding
                 console.warn(`Failed to decode body with encoding '${encoding}', falling back to utf-8.`);
                 return buffer.toString('utf-8'); // Fallback
            } else {
                throw e; // Re-throw other errors
            }
        }
    }

    async json() {
        const buffer = await this.#consumeBodyStream();
        const bodyText = buffer.toString('utf-8'); // JSON MUST be UTF-8 (or 16/32, but toString defaults cover common cases)

        if (bodyText.length === 0) {
            throw new SyntaxError("Unexpected end of JSON input");
        }
        try {
            return JSON.parse(bodyText);
        } catch (e) {
             // Augment error message for clarity
             if (e instanceof SyntaxError) {
                 throw new SyntaxError(`Failed to parse JSON: ${e.message}`);
             }
             throw e;
        }
    }

    async buffer() { // Node.js specific convenience
        const buffer = await this.#consumeBodyStream();
        return buffer; // Return the concatenated Node Buffer
    }

    async blob() {
        // Blobs are complex. We return a buffer wrapped in a basic Blob-like object.
        // A true Blob implementation requires more work (type, size tracking etc.)
        // For basic use, returning the buffer might suffice, or throw if strictness needed.
        console.warn("blob() is returning a Node Buffer wrapped in a minimal object, not a full Blob implementation.");
        const buffer = await this.#consumeBodyStream();
        const type = this.headers.get('content-type') || '';
        // Basic mimicry
        return {
            size: buffer.length,
            type: type,
            // Methods that return Promises matching Blob spec
            arrayBuffer: async () => this.arrayBuffer(), // Reuse arrayBuffer logic
            slice: (start, end, contentType) => { /* Complex to implement fully */ throw new Error("Blob.slice() not implemented") },
            stream: () => { /* Need to create a new stream from buffer */ throw new Error("Blob.stream() not implemented") },
            text: async () => this.text(), // Reuse text logic
            // Keep the buffer accessible for Node users? Non-standard.
            _buffer: buffer
        };
         // Alternative: throw new Error("Blob() not implemented in this environment.");
    }

     async arrayBuffer() {
        const buffer = await this.#consumeBodyStream();
        // Efficiently get the underlying ArrayBuffer from the Node Buffer
        // Make sure to return a copy or the correct slice if the buffer is a view
        const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
        return arrayBuffer;
     }

    // Add clone method if needed (complex, involves teeing the stream)
    // clone() {
    //     if (this.bodyUsed) {
    //         throw new TypeError("Cannot clone response: body already used");
    //     }
    //     // Cloning requires "teeing" the underlying stream, which duplicates it.
    //     // The original and the clone both read from the tee.
    //     const [stream1, stream2] = this.#body.tee();
    //     this.#body = stream1; // Replace original body with one branch of the tee
    //
    //     // Create a new response instance for the clone
    //     const clone = Object.create(FetchResponse.prototype);
    //     clone.#nodeStream = this.#nodeStream; // Reference same underlying stream (managed by tee)
    //     clone.#url = this.#url;
    //     clone.#status = this.#status;
    //     clone.#statusText = this.#statusText;
    //     clone.#headers = new FetchHeaders(this.#headers); // Clone headers
    //     clone.#redirected = this.#redirected;
    //     clone.#disturbed = this.#disturbed; // Clone should start with same disturbed state
    //     clone.#body = stream2; // Assign the other branch of the tee to the clone
    //
    //     return clone;
    // }

} // End FetchResponse Class


// --- The main fetch function (mostly similar, adjusted for new Response) ---
async function fetch(resource, options = {}) {
    // Outer promise now resolves sooner, when headers are received.
    // Errors during body reading are handled by the response methods/stream.
    return new Promise((resolve, reject) => {
        let currentUrl;
        let requestOptions = { ...options };
        let redirectCount = 0;
        let initialResource = resource;
        let redirected = false;

        const performRequest = (urlToFetch) => {
            // Using a nested promise here to handle the async nature
            // of the request setup and potential immediate errors.
            new Promise(async (resolveRequest, rejectRequest) => {
                try {
                     const url = new URL(urlToFetch, typeof initialResource === 'string' ? initialResource : undefined);
                     currentUrl = url.href;

                     const protocol = url.protocol === 'https:' ? https : http;
                     const agent = options.agent || protocol.globalAgent;

                     const nodeOptions = {
                         protocol: url.protocol,
                         hostname: url.hostname,
                         port: url.port || (url.protocol === 'https:' ? 443 : 80),
                         path: url.pathname + url.search,
                         method: requestOptions.method ? requestOptions.method.toUpperCase() : 'GET',
                         headers: {},
                         agent: agent,
                         rejectUnauthorized: requestOptions.rejectUnauthorized !== undefined ? requestOptions.rejectUnauthorized : true,
                     };

                    const fetchHeaders = new FetchHeaders(requestOptions.headers);
                    let bodyToSend = requestOptions.body;
                    let isStream = false;

                    if (bodyToSend != null) { // Check for null or undefined
                         if (typeof bodyToSend === 'string') {
                             bodyToSend = Buffer.from(bodyToSend, 'utf-8');
                             if (!fetchHeaders.has('content-type')) {
                                fetchHeaders.set('content-type', 'text/plain;charset=UTF-8');
                             }
                         } else if (bodyToSend instanceof URLSearchParams) {
                             bodyToSend = Buffer.from(bodyToSend.toString());
                             if (!fetchHeaders.has('content-type')) {
                                fetchHeaders.set('content-type', 'application/x-www-form-urlencoded;charset=UTF-8');
                             }
                         } else if (Buffer.isBuffer(bodyToSend)) {
                            // If already a buffer, do nothing special yet
                             if (!fetchHeaders.has('content-type')) {
                                // Maybe default to octet-stream? Or leave it unset?
                                // fetchHeaders.set('content-type', 'application/octet-stream');
                             }
                         } else if (bodyToSend instanceof ReadableStream) {
                              // WHATWG Stream body - Node HTTP supports this directly in newer versions
                              isStream = true;
                              // Node automatically handles Transfer-Encoding: chunked
                         } else if (typeof bodyToSend.pipe === 'function' && bodyToSend.readable) {
                              // Node Classic Stream body
                             isStream = true;
                             // Node automatically handles Transfer-Encoding: chunked
                         }
                         // TODO: Add support for FormData, Blob/File if needed (more complex)
                         else {
                             return rejectRequest(new TypeError('Unsupported body type provided to fetch'));
                         }

                         // Set Content-Length ONLY if not streaming and body has size
                         if (!isStream && bodyToSend.length != null && !fetchHeaders.has('content-length')) {
                             fetchHeaders.set('content-length', String(bodyToSend.length));
                         }
                     }

                    nodeOptions.headers = fetchHeaders._getNodeHeaders();

                    // --- Make the actual request ---
                    const req = protocol.request(nodeOptions, (res /* http.IncomingMessage */) => {
                         const status = res.statusCode;
                         const locationHeader = res.headers['location']; // Node headers are lowercase

                         const shouldRedirect = (
                             status === 301 || status === 302 || status === 307 || status === 308 || status === 303
                         ) && locationHeader;

                         const redirectMode = requestOptions.redirect || 'follow';

                         if (redirectMode === 'follow' && shouldRedirect) {
                             if (redirectCount >= MAX_REDIRECTS) {
                                 res.destroy(); // Clean up response stream
                                 return rejectRequest(new Error(`Maximum redirect limit reached (${MAX_REDIRECTS})`));
                             }
                             redirectCount++;
                             redirected = true;

                             let nextMethod = nodeOptions.method;
                              let nextBody = bodyToSend; // Preserve body by default (for 307, 308)

                             if (status === 303 || ((status === 301 || status === 302) && (nodeOptions.method !== 'GET' && nodeOptions.method !== 'HEAD'))) {
                                 nextMethod = 'GET';
                                 nextBody = null; // Discard body for GET redirect
                             }

                             // IMPORTANT: Consume the response body of the redirect response!
                             res.resume();

                             requestOptions.method = nextMethod;
                             requestOptions.body = nextBody;

                              // Re-run performRequest with the new URL, propagating the outer promise resolution
                             performRequest(locationHeader).then(resolve).catch(reject);
                             return; // Stop processing this response
                         }

                         if (redirectMode === 'error' && shouldRedirect) {
                             res.destroy(); // Clean up
                             return rejectRequest(new Error("Redirect received when redirect mode was 'error'"));
                         }

                         // --- Process the final response ---
                         // Resolve the main fetch promise with the FetchResponse instance
                         // The body stream is ready to be consumed by the caller.
                         try {
                            // The FetchResponse constructor is now synchronous
                            const fetchResponse = new FetchResponse(res, currentUrl, redirected);
                            resolve(fetchResponse); // Resolve the *outer* fetch promise
                         } catch (responseCreationError) {
                             res.destroy(); // Clean up node stream if response creation failed
                             rejectRequest(responseCreationError); // Reject the inner promise
                         }

                    }); // End protocol.request callback

                    // --- Handle Request Errors ---
                    req.on('error', (err) => {
                         // This handles socket errors, DNS errors etc.
                         rejectRequest(new Error(`Fetch failed: ${err.message || err.code || 'Unknown error'}`));
                    });

                    req.on('timeout', () => {
                     //   req.destroy(new Error('Request timed out')); // Explicitly destroy and provide error
                        // The 'error' event should follow on req.destroy()
                    });

                    // Set timeout if provided in options
                    if (options.timeout) {
                     //   req.setTimeout(options.timeout);
                    }

                    // --- Send Request Body ---
                    if (bodyToSend != null) {
                        if (isStream) {
                            // Pipe the stream (works for Node classic and WHATWG streams in modern Node)
                             // Error handling for the *source* stream is important
                             bodyToSend.on?.('error', streamErr => { // Check if .on exists (classic stream)
                                  console.error("Error reading request body stream:", streamErr);
                                  req.destroy(streamErr);
                                  // Rejecting here might be too late if headers already sent,
                                  // but destroying the request is the main action.
                                  // The request 'error' handler should catch this.
                             });
                             // For WHATWG streams, errors should ideally be propagated differently,
                             // but piping might handle some cases. Robust handling requires more complex stream management.

                            // Pipe the body stream to the request stream
                            bodyToSend.pipe(req);

                            // For WHATWG ReadableStream, Node's pipe handles ending the request.
                            // For Node classic streams, pipe also handles ending by default.
                        } else {
                             // Write Buffer/String bodies and end the request
                            req.write(bodyToSend);
                            req.end();
                        }
                    } else {
                        // No body, just end the request
                        req.end();
                    }

                } catch (setupError) {
                    // Catch synchronous errors during setup (e.g., new URL, new Headers)
                    rejectRequest(setupError);
                }
            })
            .catch(reject); // Catch errors from the inner request promise and reject the outer fetch promise

        }; // End performRequest function

        // Start the first request
        performRequest(initialResource); // Errors handled by the promise chain above

    }); // End outer Promise constructor
}

export default fetch;
// Example Usage (if running directly):
// (async () => {
//     try {
//         console.log("Fetching text...");
//         const resText = await fetch('https://httpbin.org/encoding/utf8');
//         console.log(`Status: ${resText.status}`);
//         console.log(`OK: ${resText.ok}`);
//         console.log(`Redirected: ${resText.redirected}`);
//         console.log('Headers:', Object.fromEntries(resText.headers.entries()));
//
//         // Read using .text()
//         // const text = await resText.text();
//         // console.log('Body Text:', text.substring(0, 200) + '...');
//
//         // --- OR --- Read using getReader()
//         console.log("Reading body with getReader()...");
//         if (!resText.bodyUsed) { // Check if body is usable
//             const reader = resText.body.getReader();
//             const decoder = new TextDecoder(); // Use TextDecoder for streaming text
//             let streamedText = '';
//             while(true) {
//                 const { done, value } = await reader.read(); // value is Uint8Array
//                 if (done) {
//                     console.log("Stream finished.");
//                     break;
//                 }
//                 console.log(`Received chunk of size: ${value.byteLength}`);
//                 streamedText += decoder.decode(value, { stream: true }); // Decode chunk
//             }
//              console.log('Streamed Body Text:', streamedText.substring(0, 200) + '...');
//         } else {
//             console.log("Body was already used.");
//         }
//
//         console.log("\nFetching JSON...");
//         const resJson = await fetch('https://httpbin.org/json');
//         const jsonData = await resJson.json();
//         console.log('Body JSON:', jsonData);
//
//         // Example of trying to read body twice (will fail)
//         try {
//              console.log("\nTrying to read JSON body again (should fail)...");
//              await resJson.text();
//         } catch (e) {
//             console.error("Caught expected error:", e.message);
//         }
//
//        // Example of redirect
//        console.log("\nFetching redirect...");
//        const resRedirect = await fetch('https://httpbin.org/redirect/1');
//        console.log(`Redirect Final Status: ${resRedirect.status}`);
//        console.log(`Redirect Final URL: ${resRedirect.url}`);
//        console.log(`Was redirected: ${resRedirect.redirected}`);
//        const redirectData = await resRedirect.json(); // Read body of final destination
//        console.log('Redirect Body JSON:', redirectData);
//
//
//     } catch (error) {
//         console.error('FETCH FAILED:', error);
//     }
// })();