import * as PizZip from "pizzip";

/** Parts of a DOCX that may carry a picture placeholder: the body, the headers and the footers. */
const PICTURE_PARTS = /^word\/(document|header\d+|footer\d+)\.xml$/;

/** A drawing element, the container of an image in WordprocessingML. */
const DRAWING = /<w:drawing>[\s\S]*?<\/w:drawing>/g;

/**
 * Lists the keys written in the alternative text of the document's images.
 * @param zip the DOCX.
 * @param imageKeys the picture keys of the catalog, recognized even without braces.
 * @returns the keys: every text in braces, and the plain texts that match a picture key.
 */
export function listPictureKeys(zip: PizZip, imageKeys: string[]): string[] {
  const keys = new Set<string>();
  for (const part of pictureParts(zip)) {
    for (const drawing of part.xml.match(DRAWING) ?? []) {
      const key = altTextKey(drawing, imageKeys);
      if (key) {
        keys.add(key);
      }
    }
  }
  return [...keys];
}

/**
 * Returns the parts that may carry a picture, with their XML.
 * @param zip the DOCX.
 * @returns the parts.
 */
function pictureParts(zip: PizZip): { path: string; xml: string }[] {
  return Object.keys(zip.files)
    .filter(path => PICTURE_PARTS.test(path))
    .map(path => ({ path, xml: zip.file(path)?.asText() ?? "" }));
}

/**
 * Reads the key written in the alternative text of a drawing.
 * @param drawing the drawing element.
 * @param imageKeys the picture keys, recognized even without braces.
 * @returns the key, or undefined when the text is an ordinary description.
 */
function altTextKey(drawing: string, imageKeys: string[]): string | undefined {
  const properties = /<wp:docPr\b[^>]*>/.exec(drawing)?.[0] ?? "";
  const text = (/\bdescr="([^"]*)"/.exec(properties)?.[1] ?? /\btitle="([^"]*)"/.exec(properties)?.[1] ?? "").trim();
  const braced = /^\{\{\s*([^{}]+?)\s*\}\}$/.exec(text);
  if (braced) {
    return braced[1];
  }
  return imageKeys.includes(text) ? text : undefined;
}
