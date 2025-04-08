//B"H
import streamGemini from "./streamGemini.js";
import FirestoreClient from "./firebaseAwtsmoos.js"
import htmlToText from "./htmlToText.js";


//B"H

var fire = new FirestoreClient(
    "awtsfaria",
    "AIzaSyCpzvN9j3IWAbPQeoz3Vs4H7Tqb7bhWQEY",
);

//B"H
var alreadyDidSichos = (await fire.getDocs(
    "books/Likkutei Sichos/Ai Sichos"
))//?.map(w=>w.id);
var newer = alreadyDidSichos.filter(w=>
    Date.now()  - w.timeUpdated < 1000 * 60 * 82
);


var older = alreadyDidSichos.filter(w=>
    Date.now()  - w.timeUpdated > 1000 * 60 *82
);


var alreadyIDs = older.map(w=>w.id);

console.log(alreadyDidSichos)


var TOC = await fire.getDocs(
    "books/Likkutei Sichos/TOC_VOL"
)

function sortByID(toc) {
    var obj = {};
    toc.forEach(w=> {
        if(!obj[w.id]) {
            obj[w.id] = [];
        }
        obj[w.id] = w;
    })
    return obj;
}



async function doSicha(mainText, vol, page) {
    var doc = await fire.setDocFirestore(
        'books/Likkutei Sichos/Ai Sichos', // <-- Replace with your actual collection name
        `${page}_${vol}`,      // <-- Replace with the specific ID for the document
        {               // <-- Replace with the data you want to write
            cool: (mainText),
            timeUpdated: Date.now()
        }
    )
    return doc;
}

async function getSicha(sichaRef, volume) {
    return await fire.getDoc(
        /* "books/Likkutei Sichos/Sichos/" + 
         sichaRef.page + "_" + 1*/
         "books/Likkutei Sichos/Sichos/" + 
         sichaRef.page + "_" 
         + volume
         
     )
}

async function aiifySicha(sicha, volume, page) {
    var html = sicha.Main_Text || sicha.Main_text;
    var onlyText = htmlToText(html);
    streamGemini(`
        ${onlyText}`, s => {
            console.log("Doing ID",page,volume);
        }).then(async response => {
            var doc = await doSicha(response, volume, page)
            console.log("DID",page,volume)
            return {
                doc,
                response
            }
        }  );
    
}

async function doVolume(volume, curVol) {
    
    var skip = 1
    var curSicha = 0;
    var skipVol = 1;
    var keys = Object.keys(volume)
    for(var key of keys) {
        
        curSicha++;
        if(curSicha <= skip && curVol == skipVol) {
            continue;
        }
        var sichaRef = volume[key];
        if(!sichaRef) {
            console.log("No ref",curVol, key);
            continue;
        }
        var id = sichaRef.page + "_" + curVol;
        if(!sichaRef.page) {
            console.log("No ref page",sichaRef)
            continue;
        }
        if(alreadyIDs.includes(id)) {
            console.log("Skipping",id);
            continue 
        }

     

        var actualSicha = await getSicha(sichaRef, curVol);
        if(!actualSicha) {
            console.log("SKIPPING",sichaRef)
            continue
        }
        console.log("GOT",actualSicha,actualSicha.Page)
       
        var ai =  aiifySicha(actualSicha, curVol, actualSicha.Page )
     //   console.log("DID all of ai: ai",ai);
    }
}


async function d() {

   // var sichaRef = sorted[1][0];

   var sorted = sortByID(TOC)
   var sortedArray = Object.entries(sorted)
    console.log(sortedArray)
    var curVol = 0;
    for(var volume of sortedArray) {
        curVol = volume[0];
        var volumeObj = volume[1];
        var done = await doVolume(volumeObj, curVol);
        console.log("DId volume", volumeObj);
    }
}
d();