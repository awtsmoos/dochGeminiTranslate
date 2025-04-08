//B"H
import streamGemini from "./streamGemini.js";
import awtsFirebase from "./firebaseAwtsmoos.js"
var fire = new awtsFirebase(
    "awtsfaria",
    "AIzaSyCpzvN9j3IWAbPQeoz3Vs4H7Tqb7bhWQEY",
);
/*
var docks = await fire.getDocs("books/Likkutei Sichos/Sichos/100_17")
console.log(docks);
*/
/*
var d=await fire.setDocFirestore(
    'books/Likkutei Sichos/Ai Sichos', // <-- Replace with your actual collection name
    'myDocId  2s',      // <-- Replace with the specific ID for the document
    {               // <-- Replace with the data you want to write
        cool: "Stuff 1"
    }
)*/



// Usage example
async function run() {
    try {
        console.log('Starting stream...');
        const response = await streamGemini(`B"H
            Hi`, s => {
                console.log(s);
            });
        console.log('Full response:', response);
    } catch (error) {
        console.error('Error:', error);
    }
}

run();