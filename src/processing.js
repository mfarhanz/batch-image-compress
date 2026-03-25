import imageCompression from 'browser-image-compression';
import pica from "pica";
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

// initialise pica
const picaInstance = pica({ features: ['js', 'wasm', 'ww'] });

// initialise ffmpeg
const ffmpeg = new FFmpeg();

// create a pool of canvases matching hardware concurrency
const poolSize = navigator.hardwareConcurrency || 3;
const canvasPool = Array.from({ length: poolSize }, () => {
    return typeof OffscreenCanvas !== "undefined"
        ? new OffscreenCanvas(1, 1)
        : document.createElement("canvas");
});

export async function processImageSimple({ file, maxDims, quality, onProgress = () => { } }) {
    // 'borrow' a canvas from the pool
    const canvas = canvasPool.pop();
    if (!canvas) return;

    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const supportsAlpha = ["image/png", "image/webp", "image/gif"].includes(file.type);

    try {
        const scale = Math.min(
            (maxDims && maxDims > 0) ? maxDims / bitmap.width : 1,
            (maxDims && maxDims > 0) ? maxDims / bitmap.height : 1,
            1
        );
        const width = Math.round(bitmap.width * scale);
        const height = Math.round(bitmap.height * scale);

        canvas.width = width;
        canvas.height = height;

        onProgress("redrawing image");
        const ctx = canvas.getContext("2d", {
            alpha: supportsAlpha,
            desynchronized: true
        });
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(bitmap, 0, 0, width, height);

        const targetQuality = (quality && quality > 0 && quality <= 100) ? quality / 100 : 0.8;

        onProgress("encoding blob file");
        const blob = await (canvas.convertToBlob
            ? canvas.convertToBlob({ type: "image/webp", quality: targetQuality })
            : new Promise(resolve => canvas.toBlob(resolve, "image/webp", targetQuality))
        );

        return blob;
    } catch (err) {
        console.log(err);
        throw err;
    } finally {
        bitmap.close();
        canvas.width = 1; // shrink it to save RAM while idle
        canvas.height = 1;
        canvasPool.push(canvas); // return it to the pool
    }
}

export async function processImageStrict({ file, maxSize, maxDims = undefined, quality = 80, onProgress = () => { } }) {
    const targetSizeMB = (maxSize && maxSize > 0) ? maxSize / (1024 * 1024) : 10;
    const options = {
        maxSizeMB: targetSizeMB,
        maxWidthOrHeight: maxDims ?? undefined,
        initialQuality: (quality && quality > 0 && quality <= 100) ? quality / 100 : 0.8,
        useWebWorker: true,
        fileType: 'image/webp',
        preserveExif: false,
        onProgress: (percent) => onProgress(`compressing image... ${percent}%`)
    };

    try {
        const compressedFile = await imageCompression(file, options);
        return compressedFile;
    } catch (error) {
        console.error("Compression Error:", error);
        throw error;
    }
}

export async function processImageRefined({ file, maxSize = undefined, maxDims = undefined, quality = 85, onProgress = () => { } }) {
    let bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });

    try {
        let scale = Math.min(
            (maxDims && maxDims > 0) ? maxDims / bitmap.width : 1,
            (maxDims && maxDims > 0) ? maxDims / bitmap.height : 1,
            1
        );

        let width = Math.round(bitmap.width * scale);
        let height = Math.round(bitmap.height * scale);
        let size = (maxSize && maxSize > 5000) ? maxSize : undefined;
        let targetCanvas = new OffscreenCanvas(width, height);

        onProgress("resizing image");
        await picaInstance.resize(bitmap, targetCanvas, {
            unsharpAmount: 80,
            unsharpRadius: 0.6,
            unsharpThreshold: 2
        });

        // binary search to ensure image within maxSize, using quality param
        const targetQuality = (quality && quality > 0) ? quality / 100 : 0.85;
        let low = 0.05;
        let high = targetQuality;
        let bestBlob = null;
        const iterations = size ? 6 : 1;
        if (!size) {    // if no size limit, force the mid to be equal to the target quality
            low = targetQuality;
            high = targetQuality;
        }

        for (let i = 0; i < iterations; i++) {
            let mid = Math.max(0.01, Math.min(1, (low + high) / 2));
            let blob = await targetCanvas.convertToBlob({
                type: "image/webp",
                quality: mid
            });

            onProgress(`compressing file, iteration ${i + 1}/${iterations}`);

            if (!size || size <= 0) {
                bestBlob = blob;
                break;
            }

            if (blob.size <= size) {
                bestBlob = blob;
                low = mid;
            } else {
                high = mid;
            }
        }

        // if even at lowest quality it's > maxSize, shrink dimensions by 20% and try a quick resize
        if (size > 0 && (!bestBlob || bestBlob.size > size)) {
            onProgress("file not compressed within maxSize, trying force compress");
            const extraShrink = 0.8;
            const smallCanvas = new OffscreenCanvas(Math.round(width * extraShrink), Math.round(height * extraShrink));
            await picaInstance.resize(targetCanvas, smallCanvas);
            bestBlob = await smallCanvas.convertToBlob({ type: "image/webp", quality: 0.2 });
        }

        // for garbage collection (?)
        targetCanvas.width = 0;
        targetCanvas.height = 0;

        return bestBlob;
    } finally {
        bitmap.close();
    }
}

export async function processImageFrames({ file, maxSize = undefined, maxDims = 640, quality = 80, onProgress = () => { } }) {
    if (!ffmpeg.loaded) {
        const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';
        await ffmpeg.load({
            coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
            wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
        });
        onProgress('loaded ffmpeg');
    }

    const id = Math.random().toString(36).substring(7);
    const inName = `in_${id}_${file.name}`;
    const outName = `out_${id}.webp`;

    let low = 10; // Minimum usable quality
    let high = quality; // Start with your desired quality as the max
    let bestBlob = null;
    let lastAttemptBlob = null;
    let currentIteration = 1;
    let size = (maxSize && maxSize > 10000) ? maxSize : undefined;
    const iterations = size ? 7 : 1; // limits loop to prevent infinite loop
    if (!size) {    // if no size limit, force the mid to be equal to the target quality
        low = quality;
        high = quality;
        onProgress('no size specified for gif, iterations set to 1');
    }

    ffmpeg.on('progress', ({ progress }) =>
        onProgress(`processing gif, iteration ${currentIteration}/${iterations}: ${Math.round(progress * 100)}%`)
    );

    try {
        await ffmpeg.writeFile(inName, await fetchFile(file));

        for (let i = 0; i < iterations; i++) {
            const mid = Math.floor((low + high) / 2);
            currentIteration = i + 1;

            // onProgress(`processing gif, iteration ${i}/${iterations}`);
            await ffmpeg.exec([
                '-i', inName,
                '-vf', `scale='min(${maxDims},iw)':-1:force_original_aspect_ratio=decrease`,
                '-vcodec', 'libwebp',
                '-lossless', '0',
                '-compression_level', '5', // Lowering to 5 slightly speeds up batches
                '-q:v', `${mid}`,
                '-loop', '0',
                '-preset', 'picture',
                '-an',
                '-vsync', '0',     // maintain original frame timing
                outName
            ]);

            const data = await ffmpeg.readFile(outName);
            const currentBlob = new Blob([data.buffer], { type: 'image/webp' });
            // Only update lastAttemptBlob if it's the first time OR if this new blob is smaller
            if (!lastAttemptBlob || currentBlob.size < lastAttemptBlob.size) {
                lastAttemptBlob = currentBlob;
            }

            if (size && currentBlob.size > size) {
                high = mid - 1;     // too big, lower the quality
            } else {
                bestBlob = currentBlob;    //  fits, save this one and try to see if we can get better quality
                low = mid + 1;
            }

            // cleanup before the next iteration to save WASM memory
            await ffmpeg.deleteFile(outName);

            // if cant get any smaller, stop
            if (low > high) break;
        }

        // cleanup
        await ffmpeg.deleteFile(inName);

        return bestBlob || lastAttemptBlob;
    } catch (err) {
        // Cleanup on failure so the next file doesn't start with a full disk
        try { await ffmpeg.deleteFile(inName); } catch { /* empty */ }
        try { await ffmpeg.deleteFile(outName); } catch { /* empty */ }
        throw err;
    } finally {
        ffmpeg.off('progress');
    }
}
