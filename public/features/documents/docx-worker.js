import mammoth from 'mammoth';
import { boundedDocxArchive } from './docx-archive.js';
import { validateImage } from './images.js';

self.onmessage = async ({ data }) => {
  try {
    const result = await mammoth.convertToHtml({ arrayBuffer: boundedDocxArchive(data) }, {
      externalFileAccess: false, includeEmbeddedStyleMap: false,
      convertImage: mammoth.images.imgElement(async image => {
        const src = `data:${image.contentType};base64,${await image.read('base64')}`;
        validateImage({ id: 'import', data: src });
        return { src };
      }),
    });
    self.postMessage({ html: result.value, warnings: result.messages.map(message => message.message) });
  } catch (error) { self.postMessage({ error: `Could not import DOCX: ${error.message}` }); }
};
