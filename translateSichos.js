// B"H
import streamGemini from "./streamGemini.js";
import awtsFirebase from "./firebaseAwtsmoos.js"
import htmlToText from "./htmlToText.js";


var fire = new awtsFirebase(
    "awtsfaria",
    "AIzaSyCpzvN9j3IWAbPQeoz3Vs4H7Tqb7bhWQEY",
);

// B"H
// Fetching the raw TOC documents
var TOC_docs = await fire.getDocs(
    "books/Likkutei Sichos/TOC_VOL"
);

// Function to organize TOC docs into an object keyed by Volume ID
// Assuming each doc in TOC_docs has an 'id' field for the volume number
// and other fields that represent the Sichos within that volume.
// *** This function might need adjustment based on the EXACT structure
// *** of your documents in the "TOC_VOL" collection.
function sortDocsIntoVolumeObjects(tocDocs) {
    var volumes = {};
    tocDocs.forEach(doc => {
        // Assuming doc.id is the Volume number (e.g., '1', '2')
        // And doc itself contains the keys/values for the Sichos in that volume
        // Example: doc = { id: '1', '15': { page: 15, title: '...' }, '22': { page: 22, ... } }
        if (!volumes[doc.id]) {
            // Store the data part of the doc (excluding the id field itself if necessary)
            // If the doc *is* the object of Sichos, just assign it.
            volumes[doc.id] = doc; // Or maybe = { ...doc.data() } if using Firestore SDK directly
        } else {
            // Handle cases where multiple docs might have the same volume ID if that's possible
            console.warn(`Duplicate volume ID found: ${doc.id}. Overwriting or merging might be needed.`);
            volumes[doc.id] = { ...volumes[doc.id], ...doc }; // Example: simple merge
        }
    });
    return volumes;
}


async function doSicha(mainText, vol, page) {
    const docId = `${page}_${vol}`;
    console.log(`   [Vol ${vol}] Saving AI summary to Firestore: Ai Sichos/${docId}`);
    try {
        var doc = await fire.setDocFirestore(
            'books/Likkutei Sichos/Ai Sichos', // Collection
            docId,                             // Document ID
            {                                  // Data
                aiSummary: mainText,
                originalPage: page,
                originalVolume: vol,
                processedAt: new Date().toISOString()
            }
        );
        // console.log(`   [Vol ${vol}] Successfully set doc ${docId}`);
        return doc;
    } catch (error) {
        console.error(`   [Vol ${vol}] Error setting Firestore doc ${docId}:`, error);
        throw error;
    }
}

async function getSicha(sichaRef, volume) {
     // Assume sichaRef is the object like { page: 15, title: '...' }
     if (!sichaRef || typeof sichaRef.page === 'undefined') {
         console.error(`   [Vol ${volume}] Invalid sichaRef or missing page property:`, sichaRef);
         return null;
     }
     const docPath = `books/Likkutei Sichos/Sichos/${sichaRef.page}_${volume}`;
    //  console.log(`   [Vol ${volume}] Getting Sicha from: ${docPath}`);
     try {
        const sichaDoc = await fire.getDoc(docPath);
        if (!sichaDoc) {
            console.warn(`   [Vol ${volume}] Sicha document not found at: ${docPath}`);
            return null;
        }
        // Add the page number to the returned data if it's not already there,
        // as it's needed later. Prefer 'Page' if it exists, else use 'page'.
        if (typeof sichaDoc.Page === 'undefined' && typeof sichaDoc.page === 'undefined') {
            sichaDoc.Page = sichaRef.page; // Add it from the reference
        }
        return sichaDoc;
     } catch (error) {
         console.error(`   [Vol ${volume}] Error getting Sicha from ${docPath}:`, error);
         throw error;
     }
}

async function aiifySicha(sicha, volume, page) {
    if (!sicha || (!sicha.Main_Text && !sicha.Main_text)) {
        console.warn(`   [Vol ${volume}, Page ${page}] Skipping AI: Missing text content.`);
        return null;
    }
    var html = sicha.Main_Text || sicha.Main_text;
    var onlyText = htmlToText(html);

    if (!onlyText || onlyText.trim().length === 0) {
        console.warn(`   [Vol ${volume}, Page ${page}] Skipping AI: Text empty after HTML conversion.`);
        return null;
    }

    // console.log(`   [Vol ${volume}, Page ${page}] AI-ifying...`);
    try {
        // Using a shorter, more focused prompt
        const response = await streamGemini(
            `B"H
${onlyText}`,
             s => { 
                 console.log(s); // Keep streaming off for cleaner parallel logs  
                }
        );
        // console.log(`   [Vol ${volume}, Page ${page}] AI processing complete. Saving...`);
        var doc = await doSicha(response, volume, page);
        return { doc, response };
    } catch (error) {
        console.error(`   [Vol ${volume}, Page ${page}] Error during AI processing or saving:`, error);
        throw error;
    }
}

// This function processes ONE volume sequentially internally
async function doVolume(volumeData, curVol) {
    console.log(`---> Starting processing for Volume ${curVol}`);

    // Get the keys representing Sichos within this volume (e.g., '15', '22')
    // Make sure to filter out the 'id' key if it exists on volumeData itself
    const sichaKeys = Object.keys(volumeData).filter(key => key !== 'id');

    // Optional: Sort keys if they represent pages and order matters
    sichaKeys.sort((a, b) => {
        const numA = parseInt(a, 10);
        const numB = parseInt(b, 10);
        if (!isNaN(numA) && !isNaN(numB)) {
            return numA - numB;
        }
        return a.localeCompare(b); // Fallback to string comparison
    });

    console.log(`---> [Vol ${curVol}] Found ${sichaKeys.length} Sichos. Processing sequentially...`);

    let processedCount = 0;
    let failedCount = 0;

    // Process each Sicha sequentially WITHIN this volume
    for (const key of sichaKeys) {
        const sichaRef = volumeData[key]; // Get the Sicha reference object e.g., { page: 15, ... }

        // Basic check on the reference object
        if (typeof sichaRef !== 'object' || sichaRef === null || typeof sichaRef.page === 'undefined') {
            console.warn(`---> [Vol ${curVol}] Skipping invalid Sicha reference for key '${key}':`, sichaRef);
            failedCount++;
            continue;
        }

        const pageNum = sichaRef.page; // Get the page number needed for other functions

        try {
            // console.log(`---> [Vol ${curVol}] Processing Sicha Key '${key}' (Page ${pageNum})`);

            // 1. Get Sicha Data (await ensures sequential)
            var actualSicha = await getSicha(sichaRef, curVol);

            if (!actualSicha) {
                 console.warn(`---> [Vol ${curVol}] Sicha not found or failed retrieve for Page ${pageNum}. Skipping AI.`);
                 failedCount++;
                 continue; // Move to next Sicha in this volume
            }

            // Ensure the page identifier is available for aiifySicha
            const pageIdentifier = actualSicha.Page || actualSicha.page || pageNum; // Use best available page identifier

            // 2. AI-ify Sicha Data (await ensures sequential)
            var aiResult = await aiifySicha(actualSicha, curVol, pageIdentifier);

            if (aiResult) {
                // console.log(`---> [Vol ${curVol}] Successfully processed Sicha Page ${pageIdentifier}.`);
                processedCount++;
            } else {
                // console.warn(`---> [Vol ${curVol}] AI processing skipped or failed for Sicha Page ${pageIdentifier}.`);
                failedCount++; // Count as failed if AI step doesn't complete successfully
            }

        } catch (error) {
            console.error(`---> [Vol ${curVol}] ERROR processing Sicha Key '${key}' (Page ${pageNum}):`, error);
            failedCount++;
            // Continue to the next Sicha within the volume despite the error
        }
    } // End loop for Sichos within this volume

    console.log(`<--- Finished processing Volume ${curVol}. Processed: ${processedCount}, Failed/Skipped: ${failedCount}`);
    // Return some status or summary if needed
    return { volume: curVol, processed: processedCount, failed: failedCount };
}


// Main execution function
async function d() {
   console.log("B\"H Starting the process...");

   // **Crucial**: Adjust sortDocsIntoVolumeObjects if the structure
   // of documents in TOC_VOL is different from the assumed example.
   var sortedVolumes = sortDocsIntoVolumeObjects(TOC_docs);
   var sortedArray = Object.entries(sortedVolumes); // Array like [ ['1', volume1Data], ['2', volume2Data], ... ]

   if (sortedArray.length === 0) {
       console.log("No volumes found to process based on TOC data.");
       return;
   }

   console.log(`Found ${sortedArray.length} volumes to process: [${Object.keys(sortedVolumes).join(', ')}]`);

   // Array to hold the promises for processing each volume
   const volumeProcessingPromises = [];

   console.log("Initiating processing for all volumes concurrently...");

   // Loop through each volume entry [volumeId, volumeDataObject]
   for (const [curVol, volumeObj] of sortedArray) {
       // Call doVolume for the current volume number and its data object.
       // This call is ASYNCHRONOUS and returns a Promise immediately.
       // We DON'T await it here.
       console.log(`   Queueing Volume ${curVol} for processing...`);
       const promise = doVolume(volumeObj, curVol); // Pass the volume's specific data object

       // Add the promise to our array
       volumeProcessingPromises.push(promise);
   }

   console.log(`All ${volumeProcessingPromises.length} volume processes initiated. Waiting for all to settle...`);

   // Use Promise.allSettled to wait for ALL promises to complete (either succeed or fail)
   const results = await Promise.allSettled(volumeProcessingPromises);

   console.log("-----------------------------------------");
   console.log("All Volume Processing Complete. Results:");
   console.log("-----------------------------------------");

   let totalSuccess = 0;
   let totalFailed = 0;
   results.forEach((result, index) => {
       // Original array was [ ['1', volData1], ['2', volData2], ...]
       const volNum = sortedArray[index][0]; // Get corresponding volume number
       if (result.status === 'fulfilled') {
           console.log(`Volume ${volNum}: ✅ Successfully completed. Stats:`, result.value); // result.value is the return from doVolume
           totalSuccess += result.value?.processed || 0;
           totalFailed += result.value?.failed || 0;
       } else {
           console.error(`Volume ${volNum}: ❌ Failed. Reason:`, result.reason);
           // We don't know how many failed within the volume if the whole promise rejected.
           // Need to rely on logs from doVolume or add more detail to the rejection.
       }
   });
    console.log("-----------------------------------------");
    console.log(`Overall Summary: Processed Sichos: ${totalSuccess}, Failed/Skipped Sichos: ${totalFailed}`);
    console.log("B\"H Main process finished.");
}

// Run the main function
d().catch(error => {
    console.error("🛑 An unexpected error occurred in the main execution:", error);
});