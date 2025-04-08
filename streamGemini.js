//B"H
import fetch from "./fetch.js";


// B"H

// WARNING: Embedding API keys directly in client-side code is insecure!
// Anyone can view your source code and steal the key.
// Consider using a backend proxy or serverless function to make the API call.
const apiKey = ""; // <<< INSECURE!

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
                text: `B"H\nYour job is to explain the Rebbe’s sicha in full, clear, and accessible English for someone with little or no background. Your goal is not to translate it word for word, but to explain what the Rebbe is saying in a way that makes everything understandable. Provide all the background information needed assume the reader doesn't have a good understanding of chasidus, clarify any references or concepts, and present the Rebbe’s questions and answers in a way that flows naturally. The goal is for you to explain what is being said, if there's a question for example you should explain and elaborate why it's not understood, why it matters, and how the Rebbe’s approach brings something new and meaningful.`
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

export default streamGemini;