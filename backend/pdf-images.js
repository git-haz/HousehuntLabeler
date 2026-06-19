import pdf from 'pdf-parse/lib/pdf-parse.js';

export async function extractImagesFromPdf(pdfBuffer) {
  const images = [];

  try {
    const data = await pdf(pdfBuffer, {
      pagerender: function (pageData) {
        return pageData.getOperatorList().then(ops => {
          const fns = ops.fnArray;
          const args = ops.argsArray;
          for (let i = 0; i < fns.length; i++) {
            if (fns[i] === 82 || fns[i] === 85) {
              // OPS.paintJpegXObject or OPS.paintImageXObject
            }
          }
          return '';
        });
      }
    });

    // pdf-parse doesn't directly extract images well, so we look for
    // embedded image streams in the raw PDF buffer
    const rawImages = extractRawImages(pdfBuffer);
    images.push(...rawImages);
  } catch {
    // fallback: try raw extraction only
    const rawImages = extractRawImages(pdfBuffer);
    images.push(...rawImages);
  }

  return images;
}

function extractRawImages(pdfBuffer) {
  const images = [];
  const jpegStart = Buffer.from([0xFF, 0xD8, 0xFF]);
  const jpegEnd = Buffer.from([0xFF, 0xD9]);
  const pngStart = Buffer.from([0x89, 0x50, 0x4E, 0x47]);

  let offset = 0;
  while (offset < pdfBuffer.length - 3) {
    if (pdfBuffer[offset] === 0xFF && pdfBuffer[offset + 1] === 0xD8 && pdfBuffer[offset + 2] === 0xFF) {
      const endIdx = pdfBuffer.indexOf(jpegEnd, offset + 3);
      if (endIdx > offset && endIdx - offset > 1000) {
        images.push({
          buffer: pdfBuffer.subarray(offset, endIdx + 2),
          mimeType: 'image/jpeg',
        });
      }
      offset = endIdx > offset ? endIdx + 2 : offset + 1;
    } else if (pdfBuffer[offset] === 0x89 && pdfBuffer[offset + 1] === 0x50 && pdfBuffer[offset + 2] === 0x4E && pdfBuffer[offset + 3] === 0x47) {
      const iendMarker = Buffer.from([0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82]);
      const endIdx = pdfBuffer.indexOf(iendMarker, offset);
      if (endIdx > offset && endIdx - offset > 1000) {
        images.push({
          buffer: pdfBuffer.subarray(offset, endIdx + 8),
          mimeType: 'image/png',
        });
      }
      offset = endIdx > offset ? endIdx + 8 : offset + 1;
    } else {
      offset++;
    }
  }

  // Limit to 20 largest images (most likely property photos, not icons)
  images.sort((a, b) => b.buffer.length - a.buffer.length);
  return images.slice(0, 20);
}
