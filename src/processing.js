import imageCompression from 'browser-image-compression';
import pica from "pica";
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

// initialise pica
const picaInstance = pica({ features: ['js', 'wasm', 'ww'] });

// initialise ffmpeg
let ffmpeg = new FFmpeg();

// create a pool of canvases matching hardware concurrency
const poolSize = Math.max(1, Math.min(navigator.hardwareConcurrency, 8));   // more than plimit's concurrency count, just to be safe
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

        const ctx = canvas.getContext("2d", {
            alpha: supportsAlpha,
            desynchronized: true
        });
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(bitmap, 0, 0, width, height);

        const targetQuality = (quality && quality > 0 && quality <= 100) ? quality / 100 : 0.8;
        onProgress(`processing ${file.name}`);

        const blob = await (canvas.convertToBlob
            ? canvas.convertToBlob({ type: "image/webp", quality: targetQuality })
            : new Promise(resolve => canvas.toBlob(resolve, "image/webp", targetQuality))
        );

        return blob;
    } catch (err) {
        console.error(err);
        throw err;
    } finally {
        bitmap.close();
        canvas.width = 1; // shrink it to save RAM while idle
        canvas.height = 1;
        canvasPool.push(canvas); // return it to the pool
    }
}

export async function processImageStrict({ file, maxSize, maxDims = undefined, quality = 80, onProgress = () => { } }) {
    const targetSizeMB = (maxSize && maxSize > 0) ? maxSize / (1024 * 1024) : 4;
    const options = {
        maxSizeMB: targetSizeMB,
        maxWidthOrHeight: maxDims ?? undefined,
        initialQuality: (quality && quality > 0 && quality <= 100) ? quality / 100 : 0.8,
        useWebWorker: true,
        fileType: 'image/webp',
        preserveExif: false,
        onProgress: (percent) => onProgress(`compressing ${file.name}... ${percent}%`)
    };

    try {
        const compressedFile = await imageCompression(file, options);
        return compressedFile;
    } catch (error) {
        console.error("Compression Error:", error);
        throw error;
    }
}

export async function processImageRefined({ file, maxSize = undefined, maxDims = undefined, quality = 100, onProgress = () => { } }) {
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

        await picaInstance.resize(bitmap, targetCanvas, {
            unsharpAmount: 80,
            unsharpRadius: 0.6,
            unsharpThreshold: 2
        });

        // binary search to ensure image within maxSize, using quality param
        const targetQuality = (quality && quality > 0) ? quality / 100 : 1.0;
        let low = 0.0;
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
				
            onProgress(`compressing ${file.name}, iteration ${i + 1}/${iterations}`);

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
	 
	 // clears out any files if any, from previous runs
    try {
        const files = await ffmpeg.listDir('/');
        for (const file of files) {
            const isUserFile = file.name.startsWith('in_') || file.name.startsWith('out_');
            if (!file.isDir && isUserFile) await ffmpeg.deleteFile(file.name);
        }
    } catch (e) {
        console.error("Error cleaning up ffmpeg dir: ", e);
    }

    const id = Math.random().toString(36).substring(7);
    const inName = `in_${id}_${file.name}`;
    const outName = `out_${id}.webp`;

    let low = 0; // Minimum usable quality
    let high = quality; // Start with your desired quality as the max
    let bestBlob = null;
    let lastAttemptBlob = null;
    let currentIteration = 0;
    
	 let compressionLevel = '3';
	 if (file.size < 10 * 1024 * 1024) {
		 compressionLevel = '5'; // Small file: Go for max compression
	 } else if (file.size > 80 * 1024 * 1024) {
		 compressionLevel = '1'; // Huge file: Prioritize RAM stability
	 } else if (file.size > 40 * 1024 * 1024) {
		 compressionLevel = '2'; // Large file: Lean toward speed
	 }
    
	 const size = (maxSize && maxSize > 10000) ? maxSize : undefined;
	 const iterations = size ? 7 : 1; // limits loop to prevent infinite loop
    if (!size) {    // if no size limit, force the mid to be equal to the target quality
        low = quality;
        high = quality;
    }
	 
	 let progressHandler;
    if (onProgress) {
        progressHandler = ({ progress }) => {
				onProgress(`processing ${file.name}... ${Math.min(100, Math.round((currentIteration + progress) / iterations * 100))}%`)
        };
        ffmpeg.on("progress", progressHandler);
    }

    try {
        await ffmpeg.writeFile(inName, await fetchFile(file));

        for (let i = 0; i < iterations; i++) {
            const mid = Math.floor((low + high) / 2);
            currentIteration = i;
            await ffmpeg.exec([
                '-i', inName,
                '-vf', `scale='min(${maxDims},iw)':-1:force_original_aspect_ratio=decrease`,
					 // '-vf', `scale='min(${maxDims},iw)':-1:force_original_aspect_ratio=decrease:flags=lanczos`,
                '-vcodec', 'libwebp',
                '-lossless', '0',
                '-compression_level', compressionLevel,
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
        console.error("FFmpeg Fatal Error:", err);
		  const errorMessage = String(err); 
		 const isMemoryError = 
			  errorMessage.includes("memory access out of bounds") || 
			  errorMessage.includes("RuntimeError") ||
			  (err && typeof err === 'object' && 'message' in err && err.message.includes("memory"));
        if (isMemoryError) {
        console.warn("Detected WASM Memory Crash. Resetting engine...");
        
        try {
            await ffmpeg.terminate();
        } catch (terminateErr) {
            // Worker might already be dead, that's fine
        }

        // Re-initialize the instance
        ffmpeg = new FFmpeg();
		  
		  // Short delay to give browser time to actually clear RAM before loading new ffmpeg vm
		  await new Promise(resolve => setTimeout(resolve, 300));
    }

        try { await ffmpeg.deleteFile(inName); } catch { /* ignore */ }
        try { await ffmpeg.deleteFile(outName); } catch { /* ignore */ }
        throw err;
    } finally {
        if (progressHandler) ffmpeg.off('progress', progressHandler);
    }
}
