//B"H
export default htmlToText
/**
 * Converts a simple HTML string to plain text using regular expressions.
 * NOTE: This is a basic implementation and may not handle all HTML cases
 * correctly, especially complex or malformed HTML. It avoids DOMParser
 * and is suitable for Node.js environments where DOM APIs aren't available
 * without external libraries.
 *
 * @param {string} htmlString The HTML string to convert.
 * @returns {string} The resulting plain text string.
 */

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