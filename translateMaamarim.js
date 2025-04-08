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