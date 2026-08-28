// Lectura de etiquetas (ID3v2, Vorbis comments de FLAC/OGG, chunks INFO de
// WAV, átomos de MP4) y miniatura de la carátula.
//
// Librería: music-metadata.
//   · jsmediatags pesa menos en disco (304 KB frente a 1,2 MB) pero es un
//     bundle UMD que hace require('buffer'): no empaqueta para navegador sin
//     meter polyfills de Node, y aun así no lee los chunks INFO de WAV.
//   · music-metadata es ESM puro, empaqueta limpio (226 KB minificado / 66 KB
//     gzip medidos con esbuild) y en la biblioteca de pruebas leyó FLAC, MP3
//     y WAV, carátulas incluidas.
//   Se carga con import() dinámico, así que no entra en el bundle inicial:
//   solo se descarga la primera vez que se analiza una pista.

let parserPromise = null;

function loadParser() {
  if (!parserPromise) {
    parserPromise = import("music-metadata").then((m) => m.parseBlob);
  }
  return parserPromise;
}

// Lado de la miniatura que guardamos. Las carátulas reales de la biblioteca
// venían a 110-200 KB; a 96 px se quedan en 3-6 KB, que es lo que puede
// permitirse IndexedDB con cientos de pistas.
const THUMB_SIZE = 96;

/** Reduce una carátula a una miniatura cuadrada. Devuelve un Blob o null. */
async function makeThumbnail(picture) {
  if (!picture?.data?.length) return null;
  if (typeof createImageBitmap !== "function") return null;

  const source = new Blob([picture.data], {
    type: picture.format || "image/jpeg",
  });

  try {
    const bitmap = await createImageBitmap(source);
    const side = Math.min(bitmap.width, bitmap.height);
    // Recorte centrado a cuadrado: las carátulas casi siempre lo son ya,
    // pero alguna viene con bandas y así no se deforma
    const sx = (bitmap.width - side) / 2;
    const sy = (bitmap.height - side) / 2;

    let canvas;
    if (typeof OffscreenCanvas === "function") {
      canvas = new OffscreenCanvas(THUMB_SIZE, THUMB_SIZE);
    } else {
      canvas = document.createElement("canvas");
      canvas.width = THUMB_SIZE;
      canvas.height = THUMB_SIZE;
    }
    const ctx = canvas.getContext("2d");
    ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, THUMB_SIZE, THUMB_SIZE);
    bitmap.close?.();

    if (canvas.convertToBlob) {
      return await canvas.convertToBlob({ type: "image/webp", quality: 0.8 });
    }
    return await new Promise((resolve) =>
      canvas.toBlob(resolve, "image/webp", 0.8)
    );
  } catch (err) {
    console.error("Artwork thumbnail failed", err);
    return null;
  }
}

/** Lee las etiquetas de un File/Blob de audio.
 *  Devuelve siempre un objeto (campos a null si la pista no tiene etiquetas),
 *  nunca lanza: sin etiquetas la app sigue usando el nombre del archivo. */
export async function readTrackMetadata(file) {
  const empty = { artist: null, title: null, album: null, artwork: null };
  if (!file) return empty;

  try {
    const parseBlob = await loadParser();
    const meta = await parseBlob(file, { duration: false });
    const common = meta?.common || {};

    const clean = (v) => {
      const s = typeof v === "string" ? v.trim() : "";
      return s || null;
    };

    return {
      artist: clean(common.artist || common.albumartist),
      title: clean(common.title),
      album: clean(common.album),
      artwork: await makeThumbnail(common.picture?.[0]),
    };
  } catch (err) {
    console.error(`Metadata read failed for ${file.name}`, err);
    return empty;
  }
}
