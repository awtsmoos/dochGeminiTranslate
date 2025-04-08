//B"H
import fetch from "./fetch.js"; // Assuming fetch is correctly polyfilled or available


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

export default FirestoreClient;