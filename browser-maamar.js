
//B"H
// --- Helper Function to Parse Firestore Value Objects into JS values ---
// (Keep this outside or ensure it's accessible)
function parseFirestoreValue(valueObj) {
    if (!valueObj) return undefined;

    if (valueObj.stringValue !== undefined) return valueObj.stringValue;
    if (valueObj.integerValue !== undefined) return parseInt(valueObj.integerValue, 10);
    if (valueObj.doubleValue !== undefined) return parseFloat(valueObj.doubleValue);
    if (valueObj.booleanValue !== undefined) return valueObj.booleanValue;
    if (valueObj.timestampValue !== undefined) return new Date(valueObj.timestampValue);
    if (valueObj.nullValue !== undefined) return null;
    if (valueObj.mapValue !== undefined && valueObj.mapValue.fields) {
        const map = {};
        for (const key in valueObj.mapValue.fields) {
            map[key] = parseFirestoreValue(valueObj.mapValue.fields[key]);
        }
        return map;
    }
     if (valueObj.arrayValue !== undefined && valueObj.arrayValue.values) {
        return valueObj.arrayValue.values.map(parseFirestoreValue);
    }
    // Add more types if needed (bytesValue, referenceValue, geoPointValue etc.)
    console.warn("Unsupported Firestore type:", Object.keys(valueObj)[0]);
    return undefined; // Or return the raw object if you prefer
}


// --- Helper Function to Format JS values into Firestore Value Objects ---
// (Keep this outside or ensure it's accessible)
function formatFirestoreValue(value) {
    if (value === null || value === undefined) {
        return { nullValue: null };
    }
    const type = typeof value;
    if (type === 'string') {
        return { stringValue: value };
    }
    if (type === 'boolean') {
        return { booleanValue: value };
    }
    if (type === 'number') {
        if (Number.isInteger(value)) {
            return { integerValue: String(value) }; // Firestore expects integer as string via REST
        } else {
            return { doubleValue: value };
        }
    }
    if (value instanceof Date) {
        return { timestampValue: value.toISOString() };
    }
    if (Array.isArray(value)) {
        return {
            arrayValue: {
                values: value.map(formatFirestoreValue) // Recursively format array elements
            }
        };
    }
    if (type === 'object' && value.constructor === Object) { // Plain object
        const mapFields = {};
        for (const key in value) {
            if (Object.hasOwnProperty.call(value, key)) {
                 const formatted = formatFirestoreValue(value[key]);
                 if (formatted !== undefined && formatted.nullValue === undefined && value[key] === undefined){
                     // Skip trying to write 'undefined' fields
                 } else {
                    mapFields[key] = formatted;
                 }
            }
        }
        return {
            mapValue: {
                fields: mapFields
            }
        };
    }
    console.warn("Unsupported data type for Firestore formatting:", type, value);
    return undefined;
}

// --- Helper Function to Format the whole JS object into Firestore Document Fields ---
// (Keep this outside or ensure it's accessible)
function formatFirestoreDocument(data) {
    const fields = {};
    for (const key in data) {
         if (Object.hasOwnProperty.call(data, key)) {
            const formattedValue = formatFirestoreValue(data[key]);
            if (formattedValue !== undefined && !(formattedValue.nullValue === null && data[key] === undefined)) {
                 fields[key] = formattedValue;
            } else if (data[key] !== undefined) {
                 console.warn(`Skipping field '${key}' due to unsupported type or value.`);
            }
        }
    }
    return { fields: fields };
}


// --- The FirestoreClient Class ---
class FirestoreClient {
    constructor(projectId, apiKey) {
        this.projectId = projectId;
        this.apiKey = apiKey;
        this.baseUrl = 'firestore.googleapis.com'; // Base URL kept for potential future use
    }

    // Optional: Static Document class (as you had it)
    static Document = class {
        constructor(id, data) {
            this.id = id;
            this.data = data;
        }
    };

    async setDocFirestore(collectionId, documentId, data) {
        var projectId = this.projectId;
        var apiKey = this.apiKey;

        if (!collectionId || !documentId || !data || typeof data !== 'object') {
             console.error("Missing or invalid arguments: collectionId, documentId, and data (object) are required.");
             return null; // Return null on validation failure
        }

        // Construct the Firestore REST API URL for PATCH
        const documentPath = `${collectionId}/${documentId}`;
        const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${documentPath}?key=${apiKey}`;

        console.log(`Setting document at: projects/${projectId}/databases/(default)/documents/${documentPath}`);

        try {
            const firestorePayload = formatFirestoreDocument(data);
            console.log("Sending Payload:", JSON.stringify(firestorePayload, null, 2));

            const response = await fetch(url, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify(firestorePayload)
            });

            let responseBody = null;
            try {
                 responseBody = await response.json();
            } catch(e) {
                 try {
                     responseBody = await response.text();
                 } catch (e2) { console.warn("Could not parse response body."); }
            }

            if (!response.ok) {
                console.error(`HTTP Error: ${response.status} ${response.statusText}`);
                console.error("Error Response Body:", responseBody || '(Could not parse body)');
                 if (response.status === 403) {
                    console.warn("Permission Denied (403): Check Firestore Security Rules.");
                 } else if (response.status === 400) {
                     console.warn("Bad Request (400): Check payload format.");
                 }
                // Consider throwing instead of returning null if you want errors to propagate
                // throw new Error(`Failed to set document: ${response.status} ${response.statusText}`);
                return null; // Indicate failure
            }

            console.log("Successfully set document!");
            console.log("Response:", responseBody);
            // Parse the response back into a more usable format if needed, similar to getDoc
             const nameParts = responseBody.name.split('/');
             const docId = nameParts[nameParts.length - 1];
             const parsedData = {};
             if (responseBody.fields) {
                for (const fieldName in responseBody.fields) {
                     parsedData[fieldName] = parseFirestoreValue(responseBody.fields[fieldName]);
                 }
             }
            return { id: docId, ...parsedData }; // Return the written data

        } catch (error) {
            console.error("Error setting Firestore document:", error);
             if (error.message.includes('Failed to fetch') && typeof navigator !== 'undefined' && !navigator.onLine) {
                 console.warn("Network Error: Check your internet connection.");
            }
            return null; // Indicate failure
        }
    }

    // --- NEW getDoc METHOD ---
    async getDoc(documentPath) {
        var apiKey = this.apiKey;
        var projectId = this.projectId;

        if (!documentPath || typeof documentPath !== 'string' || documentPath.split('/').length < 2) {
            console.error("Invalid document path provided. Must be 'collectionId/documentId' or longer.");
            return null; // Indicate failure due to invalid input
        }

        // Construct the Firestore REST API URL for getting a single document
        const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${documentPath}?key=${apiKey}`;

        console.log(`Fetching document from: ${url.replace(apiKey, 'YOUR_API_KEY')}`);

        try {
            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'Accept': 'application/json'
                }
            });

             let responseBody = null;
             // Try parsing JSON first for structured errors or success data
             try {
                 responseBody = await response.json();
             } catch (e) {
                // If it's not JSON, maybe it's a plain text error (less common for Firestore API)
                try {
                    responseBody = await response.text();
                } catch (e2) {
                    console.warn("Could not parse response body as JSON or text.");
                }
             }

            if (!response.ok) {
                console.error(`HTTP Error: ${response.status} ${response.statusText}`);
                console.error("Error Response Body:", responseBody || '(Could not read body)');
                if (response.status === 404) {
                     console.log(`Document not found at path: ${documentPath}`);
                     // Return null specifically for not found, consistent with Firestore SDK getDoc snapshot .exists
                     return null;
                } else if (response.status === 403) {
                     console.warn("Permission Denied (403): Check Firestore Security Rules and API Key restrictions for this path.");
                }
                // Throw or return a different indicator for other errors if needed
                 // throw new Error(`Failed to get document: ${response.status} ${response.statusText}`);
                 return undefined; // Indicate an error occurred (different from 'not found')
            }

            // Response is OK (200), data is in responseBody
            console.log("Raw API Response for getDoc:", responseBody);

            // Check if the document data (fields) actually exists in the response
            // It's possible to get a 200 OK but maybe the structure is unexpected (though unlikely for GET doc)
            if (!responseBody || !responseBody.name) {
                console.warn("Received OK status but response body is missing expected 'name' field.", responseBody);
                return undefined; // Indicate an unexpected response structure
            }


            // Extract document ID from the 'name' field
            // Format: projects/{projectId}/databases/(default)/documents/{collectionId}/{documentId/...}
            const nameParts = responseBody.name.split('/');
            const docId = nameParts[nameParts.length - 1];

            // Parse the fields using the helper function
            const fields = {};
            if (responseBody.fields) {
                 for (const fieldName in responseBody.fields) {
                    fields[fieldName] = parseFirestoreValue(responseBody.fields[fieldName]);
                }
            } else {
                console.log("Document found, but it has no fields.");
            }

            const resultDoc = { id: docId, ...fields }; // Combine ID and parsed fields

            console.log(`Successfully fetched document: ${docId}`);
            console.log("Parsed Document Data:", resultDoc);
            // Optional: Return a Document class instance if preferred
            // return new FirestoreClient.Document(docId, fields);
            return resultDoc; // Return the plain object with id and data

        } catch (error) {
            console.error(`Error fetching Firestore document at ${documentPath}:`, error);
             if (error.message.includes('Failed to fetch') && typeof navigator !== 'undefined' && !navigator.onLine) {
                 console.warn("Network Error: Check your internet connection.");
            }
            // Indicate failure (could be network, parsing, etc.)
            // Returning 'undefined' to distinguish from 'null' (document not found)
            return undefined;
        }
    }

    async getDocs(collectionPath) {
        var apiKey = this.apiKey;
        var projectId = this.projectId;

        if (!collectionPath || typeof collectionPath !== 'string') {
            console.error("Invalid collection path provided.");
            return null;
        }

        // Helper function to recursively fetch all pages
        const fetchAllPages = async (url, accumulatedDocs = []) => {
            try {
                const response = await fetch(url, {
                    method: 'GET',
                    headers: {
                        'Accept': 'application/json'
                    }
                });

                let responseBody = null;
                try {
                    responseBody = await response.json();
                } catch (e) {
                    try {
                        responseBody = await response.text();
                    } catch (e2) { console.warn("Could not parse response body."); }
                }

                if (!response.ok) {
                    console.error(`HTTP Error: ${response.status} ${response.statusText}`);
                    console.error("Error Response Body:", responseBody || '(Could not read body)');
                    if (response.status === 403) {
                        console.warn("Permission Denied (403): Check Firestore Security Rules/API Key restrictions.");
                    } else if (response.status === 404) {
                        console.warn("Not Found (404): Check if the projectId and collectionId are correct.");
                    }
                    return null; // Indicate failure
                }

                console.log("Raw API Response for getDocs page:", responseBody);

                // Parse documents from this page
                const docsFromPage = (responseBody.documents || []).map(doc => {
                    const fields = {};
                    const nameParts = doc.name.split('/');
                    const docId = nameParts[nameParts.length - 1];
                    if (doc.fields) {
                        for (const fieldName in doc.fields) {
                            fields[fieldName] = parseFirestoreValue(doc.fields[fieldName]);
                        }
                    }
                    return { id: docId, ...fields };
                });

                // Add this page's documents to the accumulated list
                const updatedDocs = accumulatedDocs.concat(docsFromPage);

                // Check for next page token
                if (responseBody.nextPageToken) {
                    console.log(`Fetching next page with token: ${responseBody.nextPageToken}`);
                    const nextUrl = `${url}&pageToken=${encodeURIComponent(responseBody.nextPageToken)}`;
                    return await fetchAllPages(nextUrl, updatedDocs); // Recursively fetch next page
                }

                // No more pages, return all accumulated documents
                return updatedDocs;

            } catch (error) {
                console.error(`Error fetching Firestore documents from ${collectionPath}:`, error);
                if (error.message.includes('Failed to fetch') && typeof navigator !== 'undefined' && !navigator.onLine) {
                    console.warn("Network Error: Check your internet connection.");
                }
                return null; // Indicate failure
            }
        };

        // Start the recursive fetch with the initial URL
        const initialUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${collectionPath}?key=${apiKey}`;
        console.log(`Fetching all documents from: ${initialUrl.replace(apiKey, 'YOUR_API_KEY')}`);

        const allDocs = await fetchAllPages(initialUrl);

        if (allDocs === null) {
            console.error("Failed to fetch all documents.");
            return null;
        }

        if (allDocs.length === 0) {
            console.log("No documents found in collection:", collectionPath);
        } else {
            console.log(`Successfully fetched ${allDocs.length} documents from ${collectionPath}:`);
            console.log(allDocs);
        }

        return allDocs;
    }

    async getDocKeys(collectionPath) {
        var apiKey = this.apiKey;
        var projectId = this.projectId;

        if (!collectionPath || typeof collectionPath !== 'string') {
            console.error("Invalid collection path provided.");
            return null;
        }

        // Construct the Firestore REST API URL with a field mask to fetch only document names
        const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${collectionPath}?key=${apiKey}&mask.fieldPaths=${
            encodeURIComponent("[]")
        }`;

        console.log(`Fetching document keys from: ${url.replace(apiKey, 'YOUR_API_KEY')}`);

        try {
            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'Accept': 'application/json'
                }
            });

            let responseBody = null;
            try {
                responseBody = await response.json();
            } catch (e) {
                try {
                    responseBody = await response.text();
                } catch (e2) { console.warn("Could not parse response body."); }
            }

            if (!response.ok) {
                console.error(`HTTP Error: ${response.status} ${response.statusText}`);
                console.error("Error Response Body:", responseBody || '(Could not read body)');
                if (response.status === 403) {
                    console.warn("Permission Denied (403): Check Firestore Security Rules/API Key restrictions.");
                } else if (response.status === 404) {
                    console.warn("Not Found (404): Check if the projectId and collectionId are correct.");
                }
                return null; // Indicate failure
            }

            console.log("Raw API Response for getDocKeys:", responseBody);

            // If no documents exist, return an empty array
            if (!responseBody.documents || responseBody.documents.length === 0) {
                console.log("No document keys found in collection:", collectionPath);
                return [];
            }

            // Extract only the document IDs from the 'name' field
            const docKeys = responseBody.documents.map(doc => {
                const nameParts = doc.name.split('/');
                return nameParts[nameParts.length - 1]; // Return just the document ID
            });

            console.log(`Successfully fetched ${docKeys.length} document keys from ${collectionPath}:`, docKeys);
            return docKeys;

        } catch (error) {
            console.error(`Error fetching Firestore document keys from ${collectionPath}:`, error);
            if (error.message.includes('Failed to fetch') && typeof navigator !== 'undefined' && !navigator.onLine) {
                console.warn("Network Error: Check your internet connection.");
            }
            return null; // Indicate failure
        }
    }

    // --- Keep Parsing methods if needed internally, but helpers are outside now ---
    // parseDocuments(...) // Can be removed if getDocs uses the external helper directly
    // parseFields(...)    // Can be removed if getDoc/getDocs use external helper directly
    // parseValue(...)     // Can be removed if using external helper directly
}


function htmlToText(htmlString) {
    if (typeof htmlString !== 'string') {
      console.error("Input must be a string.");
      return ''; // Return empty string for non-string input
    }
  
    let text = htmlString;
  
    // 1. Remove script and style elements and their content
    //    Uses [\s\S] to match any character including newlines
    text = text.replace(/<script[^>]*>([\s\S]*?)<\/script>/gi, '');
    text = text.replace(/<style[^>]*>([\s\S]*?)<\/style>/gi, '');
  
    // 2. Remove HTML comments <!-- -->
    text = text.replace(/<!--([\s\S]*?)-->/g, '');
  
    // 3. Replace <br> variants and closing block tags with a newline
    //    This helps create line breaks where they visually appear.
    //    Added common block-level tags.
    text = text.replace(/<br\s*\/?>/gi, '\n');
    text = text.replace(/<\/(p|div|h[1-6]|li|tr|td|th|blockquote|article|aside|details|dialog|dd|dl|dt|fieldset|figcaption|figure|footer|form|header|hr|main|menu|nav|ol|pre|section|table|ul)>/gi, '\n');
  
    // 4. Remove remaining HTML tags (opening and self-closing)
    text = text.replace(/<[^>]*>/g, '');
  
    // 5. Decode common HTML entities. Order is important for &
    //    Basic set:  , <, >, &, ", '
    text = text.replace(/ /gi, ' ');
    text = text.replace(/</gi, '<');
    text = text.replace(/>/gi, '>');
    text = text.replace(/"/gi, '"');
    text = text.replace(/'/gi, "'");
    // Decode & last to avoid double-decoding (e.g., &lt; becoming <)
    text = text.replace(/&/gi, '&');
  
    // 6. Decode numerical HTML entities (decimal and hex)
    try {
        // Decimal entities (e.g.,  )
        text = text.replace(/&#(\d+);/g, function(match, dec) {
            return String.fromCharCode(dec);
        });
        // Hex entities (e.g.,  )
        text = text.replace(/&#x([0-9a-fA-F]+);/g, function(match, hex) {
            return String.fromCharCode(parseInt(hex, 16));
        });
    } catch (e) {
        console.error("Error decoding numerical entities:", e);
        // Continue even if decoding fails for some entities
    }
  
  
    // 7. Normalize whitespace:
    //    - Replace multiple spaces with a single space
    //    - Replace multiple newlines with max two newlines (like paragraphs)
    //    - Trim leading/trailing whitespace
    text = text.replace(/ +/g, ' '); // Collapse multiple spaces to one
    text = text.replace(/\n\s*\n/g, '\n\n'); // Collapse multiple newlines to max two
    text = text.trim(); // Remove leading/trailing whitespace
  
    return text;
  }
// B"H

// WARNING: Embedding API keys directly in client-side code is insecure!
// Anyone can view your source code and steal the key.
// Consider using a backend proxy or serverless function to make the API call.
const apiKey = "AIzaSyDRSP01fBedtbogAQp3k24mG4E1SztUzSE"; // <<< INSECURE!

async function streamGemini(prompt, onChunk) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro-preview-03-25:streamGenerateContent?alt=sse&key=${apiKey}`; // Updated model name slightly, check Gemini docs if needed

    const requestData = {
        contents: [{
            parts: [{ text: prompt }]
        }],
        generationConfig: {
            temperature: 1,
            topP: 0.95,
            topK: 64,
            maxOutputTokens: 65536, // Adjusted slightly, 65k might be too high for some contexts
        },
        systemInstruction: {
            parts: [{
                text: `B"H\nYour job is to explain the Rebbe’s maamer in full, clear, and accessible English for someone with little or no background. Your goal is not to translate it word for word, but to explain what the Rebbe is saying in a way that makes everything understandable. Provide all the background information needed assume the reader doesn't have a good understanding of chasidus, clarify any references or concepts, and present the Rebbe’s questions and answers in a way that flows naturally.  The goal is fpr you to explain what is being said, if there's a question for example you should explain and elaborate why it's not understood, why it matters, and how the Rebbe’s approach brings something new and meaningful.`
            }]
        }
    };

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestData)
        });

        if (!response.ok) {
            const errorBody = await response.text();
            throw new Error(`API request failed with status ${response.status}: ${errorBody}`);
        }

        if (!response.body) {
            throw new Error("Response body is null");
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let fullResponse = '';
        let buffer = ''; // Buffer for incomplete lines

        while (true) {
            const { done, value } = await reader.read();
            if (done) {
                console.log('Stream finished.');
                break;
            }

            // Add the chunk to the buffer
            buffer += decoder.decode(value, { stream: true }); // Use stream: true for proper multi-byte char handling

            // Process buffer line by line (SSE messages end with \n\n, but data lines end with \n)
            let lines = buffer.split('\n');

            // Keep the last potentially incomplete line in the buffer
            buffer = lines.pop() || '';

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const jsonStr = line.substring(6).trim(); // Remove 'data: ' prefix and trim
                    if (jsonStr) { // Ensure it's not just "data: "
                        try {
                            const parsed = JSON.parse(jsonStr);
                            const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text || '';
                            if (text) {
                                fullResponse += text;
                                if (onChunk && typeof onChunk === 'function') {
                                    try {
                                        onChunk(text); // Call the callback for real-time updates
                                    } catch (callbackError) {
                                        console.error("Error in onChunk callback:", callbackError);
                                    }
                                }
                            }
                            // Handle other potential fields if needed (e.g., finishReason)
                            const finishReason = parsed.candidates?.[0]?.finishReason;
                            if (finishReason && finishReason !== "STOP") {
                                console.warn("Stream ended with reason:", finishReason);
                                // Potentially handle safety settings blocks, etc.
                            }

                        } catch (e) {
                            console.error('Error parsing JSON line:', jsonStr, e);
                            // Decide how to handle parse errors - skip line? Accumulate buffer?
                        }
                    }
                } else if (line.trim()) {
                   // console.log("Received non-data line (e.g., comment or empty):", line);
                }
            }
        }
         // Process any remaining data in the buffer after the stream ends (though usually SSE ends cleanly)
         if (buffer.startsWith('data: ')) {
             // ... (handle potential final chunk like above) ...
         }


        return fullResponse; // Resolve the promise with the full concatenated text

    } catch (error) {
        console.error("Error streaming Gemini:", error);
        throw error; // Re-throw or reject the promise
    }
}

//B"H

var fire = new FirestoreClient(
    "awtsfaria",
    "AIzaSyCpzvN9j3IWAbPQeoz3Vs4H7Tqb7bhWQEY",
);

//B"H
var alreadyDidSichos = (await fire.getDocs(
    "books/Meluket/Ai Maamarim"
))//?.map(w=>w.id);
var newer = alreadyDidSichos.filter(w=>
    Date.now()  - w.timeUpdated < 1000 * 60 * 82
);


var older = alreadyDidSichos.filter(w=>
    Date.now()  - w.timeUpdated > 1000 * 60 *82
);


var alreadyIDs = older.map(w=>w.id);

console.log(alreadyDidSichos)


var allMaamarim = await fire.getDocs(
    "books/Meluket/Maamarim"
)




async function doMaamar(mainText, id) {
    var doc = await fire.setDocFirestore(
        'books/Meluket/Ai Maamarim', // <-- Replace with your actual collection name
        id,      // <-- Replace with the specific ID for the document
        {               // <-- Replace with the data you want to write
            cool: (mainText),
            timeUpdated: Date.now()
        }
    )
    return doc;
}

async function aiifyMaamar(sicha, id) {
    var html = sicha.Main_Text || sicha.Main_text;
    var onlyText = htmlToText(html);
    streamGemini(`
        ${onlyText}`, s => {
            console.log("Doing ID",id);
        }).then(async response => {
            var doc = await doMaamar(response, id)
            console.log("DID",id)
            return {
                doc,
                response
            }
        }  );
    
}



async function d() {

   // var sichaRef = sorted[1][0];

   
    for(var maamar of allMaamarim) {
        var id = maamar.id;
      
        
        aiifyMaamar(maamar, id )
        break;
    }
    console.log("Done?")
}
d();