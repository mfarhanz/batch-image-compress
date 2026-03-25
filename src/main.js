import JSZip from "jszip";
import pLimit from "p-limit";
import { processImageSimple, processImageRefined, processImageStrict, processImageFrames } from "./processing";

// const serverUrl = import.meta.env.VITE_SERVER_URL;
const resultsDiv = document.getElementById("results");
const qualitySlider = document.getElementById("quality");
const qualityValue = document.getElementById("qualityValue");
const folderInput = document.getElementById("folderInput");
const fileInput = document.getElementById("fileInput");
const fileInputButton = document.getElementById("fileInputButton");
const folderInputButton = document.getElementById("folderInputButton");
const imageToggle = document.getElementById("toggleImageSettings");
const sizeToggle = document.getElementById("toggleSizeLimit");
const hqToggle = document.getElementById("hqToggle");
const hqWarning = document.getElementById("hqWarning");
const fsInfo = document.getElementById("fsInfo");
const imageCard = document.getElementById("imageSettingsCard");
const sizeCard = document.getElementById("sizeLimitCard");
const sizeSlider = document.getElementById("maxFileSize");
const sizeValue = document.getElementById("sizeValue");
const statusBar = document.getElementById("statusBar");
const progressBar = document.getElementById("progressBar");
const summary = document.getElementById("summary");
const errorCard = document.getElementById("error-card");
const errorMessage = document.getElementById("error-message");
const errorInfo = document.getElementById("error-info");
const errorList = document.getElementById("error-list");
const errorArrow = document.getElementById("error-arrow");
const errorHeader = document.getElementById("error-header");
const downloadAll = document.getElementById("download-zip-btn");
const downloadAllWrapper = document.getElementById("download-zip-wrapper");
const zipProgressContainer = document.getElementById("zip-progress");
// eslint-disable-next-line no-undef
const zipProgressBar = new ProgressBar.Circle(zipProgressContainer, {
    strokeWidth: 6,
    color: "#c7d2fe",
    trailColor: "#e5e7eb",
    trailWidth: 6,
    easing: "easeInOut",
    duration: 20,
    text: {
        autoStyleContainer: false
    },
    from: { color: "#c7d2fe" },
    to: { color: "#c7d2fe" },
    step: function (state, circle) {
        const value = Math.round(circle.value() * 100);
        circle.setText(value ? `${value}%` : "");
    }
});
zipProgressBar.text.style.fontFamily = "monospace";
zipProgressBar.text.style.fontSize = "13px";
zipProgressBar.text.style.color = "#9dbfff";

const MAX_BATCH_SIZE = 20;
const MAX_FILE_BYTES = 100 * 1000 * 1000;
const MAX_BATCH_BYTES = 300 * 1000 * 1000;
const limitThreads = pLimit(navigator.hardwareConcurrency || 3);

let completedFiles = 0; // for progress bar across all batches
let totalFiles = 0;
let fileBuffer = [];
let failedFiles = [];

updateCards();

imageToggle.addEventListener("change", () => updateCards(imageToggle));
sizeToggle.addEventListener("change", () => {
    updateCards(sizeToggle);
    fsInfo.classList.toggle("hidden", !sizeToggle.checked);
});

folderInput.addEventListener("change", () => {
    fileInput.value = ""; // clear individual files
});

fileInput.addEventListener("change", () => {
    folderInput.value = ""; // clear folder selection
});

qualitySlider.addEventListener("input", () => {
    qualityValue.textContent = qualitySlider.value;
});

fileInputButton.addEventListener("click", () => {
    const input = document.getElementById("fileInput");
    handleUpload(input.files);
});

folderInputButton.addEventListener("click", () => {
    const input = document.getElementById("folderInput");
    handleUpload(input.files);
});

hqToggle.addEventListener("change", () => {
    hqWarning.classList.toggle("hidden", !hqToggle.checked);
});

errorHeader.onclick = () => {
    if (errorList.classList.contains("expanded")) {
        // collapse
        errorInfo.style.display = "none";
        errorList.style.maxHeight = "0px";
        errorList.style.padding = "0 12px";
        errorList.classList.remove("expanded");
        errorArrow.textContent = "▼";
    } else {
        // expand dynamically to fit content
        errorInfo.style.display = "block";
        errorList.style.maxHeight = errorList.scrollHeight + "px";
        errorList.style.padding = "8px 12px";
        errorList.classList.add("expanded");
        errorArrow.textContent = "▲";
    }
};

sizeSlider.addEventListener("input", () => {
    const val = Number(sizeSlider.value);
    let snapped;

    if (val <= 1000) {
        snapped = Math.round(val / 50) * 50;
        sizeValue.textContent = snapped + " KB";
    }
    else {
        if (val <= 3000) snapped = Math.round(val / 500) * 500;
        else snapped = Math.round(val / 1000) * 1000;

        sizeValue.textContent = (snapped / 1000).toFixed(2).replace(/\.?0+$/, "") + " MB";
    }

    sizeSlider.value = snapped;
});

downloadAll.addEventListener("click", async () => {
    if (!fileBuffer.length) return alert("No files to download!");

    zipProgressContainer.classList.add("show");
    zipProgressBar.set(0);
    downloadAll.disabled = true;
    const total = fileBuffer.length;
    let completed = 0;

    const zip = new JSZip();
    const folder = zip.folder("bulk-download");

    // Fetch all files and add to zip
    for (const file of fileBuffer) {
        folder.file(file.name, file.blob);
        completed++;
        zipProgressBar.animate(completed / total);
    }

    // Generate zip and trigger download
    const content = await zip.generateAsync({ type: "blob" });
    const link = document.createElement("a");
    const url = URL.createObjectURL(content);
    link.href = url;
    link.download = "files.zip";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);

    zipProgressBar.animate(1);
    // Hide after done
    setTimeout(() => {
        zipProgressContainer.classList.remove("show");
        downloadAll.disabled = false;
    }, 2000);
});

function setInputsDisabled(card, disabled) {
    card.querySelectorAll("input").forEach(el => {
        if (el.type !== "checkbox") {
            el.disabled = disabled;
        }
    });
}

function setStatus(text) {
    statusBar.textContent = text;
}

function updateCards(clickedToggle) {
    if (!imageToggle.checked && !sizeToggle.checked) {
        if (clickedToggle === imageToggle) {
            sizeToggle.checked = true;
        } else {
            imageToggle.checked = true;
        }
    }

    imageCard.classList.toggle("disabled", !imageToggle.checked);
    sizeCard.classList.toggle("disabled", !sizeToggle.checked);
    setInputsDisabled(imageCard, !imageToggle.checked);
    setInputsDisabled(sizeCard, !sizeToggle.checked);
}

function clearBuffers() {
    fileBuffer.forEach(f => URL.revokeObjectURL(f.url));
    fileBuffer = [];
    failedFiles = [];
}

function clearUI() {
    resultsDiv.innerHTML = "";
    summary.style.display = "none";
    errorCard.style.display = "none";
    errorList.innerHTML = "";
    progressBar.style.width = "0%";      // reset
    progressBar.style.backgroundColor = "";
    statusBar.classList.add("hidden");
    downloadAllWrapper.style.display = "none";
}

function createFileItem(file) {
    const container = document.createElement("div");
    const item = document.createElement("div");
    item.className = "file-item";

    // only on error/corrupted/unsupported files
    if (file.error) {
        item.textContent = `${file.name} - ${file.error}`;
        item.style.fontWeight = "normal";
        item.style.color = "red";
        container.appendChild(item);
        return container;
    }

    // LEFT SIDE (filename)
    const nameSpan = document.createElement("span");
    nameSpan.textContent = file.name;

    // RIGHT SIDE CONTAINER
    const rightSide = document.createElement("div");
    rightSide.className = "file-meta";
    // original size
    const oldSizeSpan = document.createElement("span");
    oldSizeSpan.textContent = formatSize(file.oldSize);
    oldSizeSpan.className = "size";
    // arrow separator (optional but nice)
    const arrow = document.createElement("span");
    arrow.textContent = "→";
    // new size
    const sizeSpan = document.createElement("span");
    sizeSpan.textContent = formatSize(file.size);
    sizeSpan.className = "size";

    // percent change
    const percentSaved = Math.round(((file.oldSize - file.size) / file.oldSize) * 100);
    const percentChangeSpan = document.createElement("span");
    if (percentSaved >= 0) {
        percentChangeSpan.textContent = `(compressed ${percentSaved}%)`;
        percentChangeSpan.style.color = percentSaved < 25 ? "#e74c3c" : "#2ecc71";
    } else {
        percentChangeSpan.textContent = `(increased ${Math.abs(percentSaved)}%)`;
        percentChangeSpan.style.color = "#e74c3c";
    }
    percentChangeSpan.className = "size";

    // download link
    const downloadLink = document.createElement("a");
    downloadLink.href = file.url;
    downloadLink.download = file.name || "image.webp";
    downloadLink.textContent = "Download";
    downloadLink.className = "download-link";
    downloadLink.onclick = (e) => e.stopPropagation();

    // append RIGHT SIDE in order
    rightSide.appendChild(oldSizeSpan);
    rightSide.appendChild(arrow);
    rightSide.appendChild(sizeSpan);
    rightSide.appendChild(percentChangeSpan);
    rightSide.appendChild(downloadLink);

    item.appendChild(nameSpan);   // LEFT
    item.appendChild(rightSide);  // RIGHT

    const details = document.createElement("div");
    details.className = "details";
    const img = document.createElement("img");
    img.src = file.url;
    details.appendChild(img);

    // toggle behavior
    item.onclick = () => {
        details.style.display =
            details.style.display === "none" ? "block" : "none";
    };

    container.appendChild(item);
    container.appendChild(details);
    return container;
}

function showErrorCard(message, files, error = "") {
    errorMessage.textContent = `${message} (${files.length})`;
    errorList.innerHTML = "";

    files.forEach(file => {
        const item = document.createElement("div");
        item.classList.add("error-list-item");

        const nameEl = document.createElement("span");
        nameEl.textContent = file.name;

        const sizeMB = (file.size / (1024 * 1024)).toFixed(2);
        const sizeEl = document.createElement("span");
        sizeEl.textContent = `${sizeMB} MB`;

        // If file > 100MB, make size red and add tooltip
        if (file.size > 100 * 1024 * 1024) {
            sizeEl.style.color = "#ff0000"; // red
            item.title = "This file may not be processed because it exceeds 100MB";
        }

        item.appendChild(nameEl);
        item.appendChild(sizeEl);
        errorList.appendChild(item);
    });

    // Set info text
    errorInfo.textContent = error ?
        `The server could not process this batch of images due to the following reason: ${error}` : "";
    errorInfo.style.display = "none";  // hidden initially

    // show card
    errorCard.style.display = "block";
    errorList.classList.remove("expanded");
    errorArrow.textContent = "▼";
}

const formatSize = (bytes) => {
    if (bytes > 1024 * 1024)
        return (bytes / (1024 * 1024)).toFixed(2) + " MB";
    if (bytes > 1024)
        return (bytes / 1024).toFixed(2) + " KB";
    return bytes + " B";
};

const clamp = (v, min, max) => Math.min(Math.max(v, min), max);

const isSkippable = (file) => {
    return file.type.startsWith("video/");
};

async function onFileProcessed(data) {
    let blobUrl = null;
    if (data.blob) {
        blobUrl = URL.createObjectURL(data.blob);
        fileBuffer.push({
            name: data.name,
            blob: data.blob,
            url: blobUrl
        });

        completedFiles++;
    }

    const el = createFileItem({ ...data, url: blobUrl });
    resultsDiv.appendChild(el);

    window.scrollTo({
        top: document.body.scrollHeight,
        behavior: "smooth"
    });
    // Update progress bar incrementally
    progressBar.style.width = Math.round((completedFiles / totalFiles) * 100) + "%";
    // tiny delay to let UI render smoothly
    await new Promise(r => setTimeout(r, 50));
}

export async function handleUpload(files) {
    if (!files.length) return;

    clearBuffers();
    clearUI();
    fileInputButton.disabled = true;
    folderInputButton.disabled = true;
    // progressBar.style.display = "block";
    statusBar.classList.remove("hidden");
    progressBar.classList.add("progress-shimmer");
    setStatus("processing");

    let errorMessage;
    let maxDims = null;
    let quality = null;
    let maxSize = null;
    let failed = 0;
    let skipped = 0;
    completedFiles = 0;
    totalFiles = files.length;

    const totalBatches = Math.ceil(files.length / MAX_BATCH_SIZE);

    // image settings
    if (imageToggle.checked) {
        const rawMaxDims = parseInt(document.getElementById("maxDims").value) || 1024;
        const rawQuality = parseInt(document.getElementById("quality").value) || 80;
        maxDims = clamp(rawMaxDims, 1, 8000);
        quality = clamp(rawQuality, 10, 100);
    }

    // size settings
    if (sizeToggle.checked) {
        const rawMaxSize = parseInt(document.getElementById("maxFileSize").value) || 500;
        maxSize = clamp(rawMaxSize, 50, 5000) * 1000; // slider is in KB, convert to bytes
    }

    for (let i = 0; i < files.length; i += MAX_BATCH_SIZE) {
        const batch = Array.from(files).slice(i, i + MAX_BATCH_SIZE);
        const batchSize = batch.reduce((sum, f) => sum + f.size, 0);

        try {
            await Promise.all(
                batch.map(file => limitThreads(async () => {
                    // skip unsupported files
                    if (isSkippable(file)) {
                        skipped++;
                        await onFileProcessed({
                            name: file.name,
                            error: "File not processed: Unsupported media type"
                        });
                        return;
                    } else if (batchSize > MAX_BATCH_BYTES) {
                        throw new Error(`Total batch size exceeded the max limit (${MAX_BATCH_BYTES/(1000 * 1000)}MB)`);
                    }

                    const baseName = file.name.replace(/\.[^.]+$/, "");
                    const outputName = `${baseName}.webp`;
                    setStatus(`processing ${file.name}`);

                    let blob;

                    try {
                        if (file.size > MAX_FILE_BYTES) {
                            throw new Error(`File too big to process (greater than ${MAX_FILE_BYTES / (1000 * 1000)}MB)`);
                        }

                        // only for gifs
                        if (!hqToggle.checked) {
                            if (file.type === "image/gif") {
                                if (sizeToggle.checked) {
                                    blob = await processImageFrames({
                                        file,
                                        maxSize,
                                        maxDims,
                                        quality,
                                        onProgress: (m) => setStatus(m)
                                    });
                                } else {
                                    blob = await processImageFrames({
                                        file,
                                        maxDims,
                                        quality,
                                        onProgress: (m) => setStatus(m)
                                    });
                                }
                            }

                            // if size contraint enabled...
                            else if (sizeToggle.checked) {
                                blob = await processImageStrict({
                                    file,
                                    maxSize,
                                    maxDims,
                                    quality,
                                    onProgress: (m) => setStatus(m)
                                });
                            }

                            // otherwise default to this
                            else if (imageToggle.checked) {
                                blob = await processImageSimple({
                                    file,
                                    maxDims,
                                    quality,
                                    onProgress: (m) => setStatus(m)
                                });
                            }

                            // fallback (shouldn't happen really)
                            else {
                                throw new Error("No processing mode selected");
                            }
                        } else {
                            blob = await processImageRefined({
                                file,
                                maxSize,
                                maxDims,
                                quality,
                                onProgress: (m) => setStatus(m)
                            });
                        }

                        if (!blob) {
                            throw new Error("Could not process file with current parameters");
                        } else {
                            await onFileProcessed({
                                name: outputName,
                                originalName: file.name,
                                blob,
                                size: blob.size,
                                oldSize: file.size
                            });
                        }
                    } catch (e) {
                        failed++;
                        await onFileProcessed({
                            name: file.name,
                            error: e.message ?? "Error processing image"
                        });
                    }
                }))
            );

        } catch (err) {
            failedFiles.push(...batch);
            failed += batch.length
            errorMessage = err.message;
            console.error(errorMessage);
        } finally {
            setStatus(`processed batch ${Math.floor(i / MAX_BATCH_SIZE) + 1}/${totalBatches}`)
        }
    }

    setStatus("done");

    // short delay before updating UI to accomodate for any pending file-processed events
    setTimeout(() => {
        if (failedFiles.length) {
            showErrorCard("Some files failed to process", [...failedFiles], errorMessage ?? null);
        }

        summary.textContent = `(Processed ${completedFiles}/${totalFiles} files • ${failed} failed • ${skipped} skipped)`;
        summary.style.display = "block";
        // done processing all batches
        progressBar.style.width = "100%";   // ensure 100 to show done processing
        progressBar.classList.remove("progress-shimmer");
        progressBar.style.backgroundColor = "#2ecc71";
        statusBar.classList.add("hidden");
        downloadAllWrapper.style.display = "flex";
        fileInputButton.disabled = false;
        folderInputButton.disabled = false;
    }, 1000);
}
