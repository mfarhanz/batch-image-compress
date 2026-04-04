import JSZip from "jszip";
import pLimit from "p-limit";
import moonSVG from './icons/moon.svg?raw';
import sunSVG from './icons/sun.svg?raw';
import stopSVG from "./icons/stop.svg?raw";
import downloadSVG from './icons/download.svg?raw';
import { router, registerHomeInit } from "./router.js";
import { processImageSimple, processImageRefined, processImageStrict, processImageFrames } from "./processing";

let resultsDiv, qualitySlider, qualityValue, folderInput, fileInput,
    fileInputButton, folderInputButton, imageToggle,
    sizeToggle, hqToggle, hqWarning, fsInfo, imageCard, sizeCard,
    sizeSlider, sizeValue, statusBar, progressBar, summary,
    errorCard, errorMessage, errorInfo, errorList, errorArrow,
    errorHeader, stopButton, downloadAll, downloadAllWrapper,
    zipProgressContainer, zipProgressBar;

const MAX_BATCH_SIZE = 20;
const MAX_FILE_BYTES = 100 * 1000 * 1000;
const MAX_BATCH_BYTES = 300 * 1000 * 1000;
const limitThreads = pLimit(Math.max(1, Math.min(navigator.hardwareConcurrency, 5)));   // 5 parallel threads is enough

let completedFiles = 0; // for progress bar across all batches
let totalFiles = 0;
let fileBuffer = [];
let failedFiles = [];
let cancelProcessing = false;
let darkMode = false;

// Set up common initial elements
const themeToggle = document.getElementById("themeToggle");
const year = document.getElementById("year");
themeToggle.innerHTML = darkMode ? sunSVG : moonSVG;
year.textContent = new Date().getFullYear();

themeToggle.addEventListener('click', () => {
    darkMode = !darkMode;
    document.body.classList.toggle('dark', darkMode);
    themeToggle.innerHTML = darkMode ? sunSVG : moonSVG;
});

export function initHome() {
    resultsDiv = document.getElementById("results");
    qualitySlider = document.getElementById("quality");
    qualityValue = document.getElementById("qualityValue");
    folderInput = document.getElementById("folderInput");
    fileInput = document.getElementById("fileInput");
    fileInputButton = document.getElementById("fileInputButton");
    folderInputButton = document.getElementById("folderInputButton");
    imageToggle = document.getElementById("toggleImageSettings");
    sizeToggle = document.getElementById("toggleSizeLimit");
    hqToggle = document.getElementById("hqToggle");
    hqWarning = document.getElementById("hqWarning");
    fsInfo = document.getElementById("fsInfo");
    imageCard = document.getElementById("imageSettingsCard");
    sizeCard = document.getElementById("sizeLimitCard");
    sizeSlider = document.getElementById("maxFileSize");
    sizeValue = document.getElementById("sizeValue");
    statusBar = document.getElementById("statusBar");
    progressBar = document.getElementById("progressBar");
    summary = document.getElementById("summary");
    errorCard = document.getElementById("error-card");
    errorMessage = document.getElementById("error-message");
    errorInfo = document.getElementById("error-info");
    errorList = document.getElementById("error-list");
    errorArrow = document.getElementById("error-arrow");
    errorHeader = document.getElementById("error-header");
    stopButton = document.getElementById("stop-btn");
    downloadAll = document.getElementById("download-zip-btn");
    downloadAllWrapper = document.getElementById("download-zip-wrapper");
    zipProgressContainer = document.getElementById("zip-progress");

    stopButton.insertAdjacentHTML("afterbegin", stopSVG);

    if (zipProgressContainer) {
        zipProgressContainer.innerHTML = '';
        // eslint-disable-next-line no-undef
        zipProgressBar = new ProgressBar.Circle(zipProgressContainer, {
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
    }

    // Exit if we are not on the home page
    if (!resultsDiv) return;

    updateCards();
    attachListeners();
}

function attachListeners() {
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

    stopButton.addEventListener("click", () => {
        if (cancelProcessing) return;
        cancelProcessing = true;
        stopButton.classList.add("loading");
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
}

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
    container.className = "file-container";

    // only on error/corrupted/unsupported files
    if (file.error) {
        item.textContent = `${file.name} - ${file.error}`;
        item.className = "file-error";
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
    const sizeContainer = document.createElement("div");
    sizeContainer.className = "size-container";
    const oldSizeSpan = document.createElement("span");
    oldSizeSpan.textContent = formatSize(file.oldSize);
    oldSizeSpan.className = "size";
    // arrow separator
    const arrow = document.createElement("span");
    arrow.textContent = "→";
    // new size
    const sizeSpan = document.createElement("span");
    sizeSpan.textContent = formatSize(file.size);
    sizeSpan.className = "size";
    sizeContainer.appendChild(oldSizeSpan);
    sizeContainer.appendChild(arrow);
    sizeContainer.appendChild(sizeSpan);

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
    downloadLink.className = "download-link";
    downloadLink.onclick = (e) => e.stopPropagation();
    // download icon (mobile)
    const icon = document.createElement("div");
    icon.innerHTML = downloadSVG;
    icon.className = "download-icon";
    // download label (pc)
    const label = document.createElement("span");
    label.textContent = "Download";
    label.className = "download-text";
    downloadLink.appendChild(icon);
    downloadLink.appendChild(label);

    // append RIGHT SIDE in order

    rightSide.appendChild(sizeContainer);
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
    return !file.type.startsWith("image/");
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

    // to ensure the DOM update doesn't fight with the transition animation
    requestAnimationFrame(() => {
        const percentage = Math.round((completedFiles / totalFiles) * 100);
        progressBar.style.width = percentage + "%";

        window.scrollTo({
            top: document.body.scrollHeight,
            behavior: "smooth"
        });
    });
    // tiny delay to let UI render transitions smoothly
    await new Promise(resolve => setTimeout(resolve, 0));
}

export async function handleUpload(files) {
    if (!files.length) return;

    clearBuffers();
    clearUI();
    cancelProcessing = false;
    fileInputButton.disabled = true;
    folderInputButton.disabled = true;
    // progressBar.style.display = "block";
    stopButton.classList.remove("hidden");
    stopButton.classList.remove("loading");
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

    // image settings
    if (imageToggle.checked) {
        const rawMaxDims = parseInt(document.getElementById("maxDims").value) || 1024;
        const rawQuality = parseInt(document.getElementById("quality").value) || 80;
        maxDims = clamp(rawMaxDims, 10, 8000);
        quality = clamp(rawQuality, 1, 100);
    }

    // size settings
    if (sizeToggle.checked) {
        const rawMaxSize = parseInt(document.getElementById("maxFileSize").value) || 500;
        maxSize = clamp(rawMaxSize, 5, 5000) * 1000; // slider is in KB, convert to bytes
    }

    const allFiles = Array.from(files);
    const gifFiles = allFiles.filter(f => f.type === "image/gif");
    const imageFiles = allFiles.filter(f => f.type !== "image/gif");

    if (imageFiles.length > 0) {
        setStatus("processing image files first");
        const filesArray = Array.from(imageFiles);

        for (let i = 0; i < imageFiles.length; i += MAX_BATCH_SIZE) {
            if (cancelProcessing) {
                skipped += imageFiles.length - i;
                setStatus("stopped processing");
                break;
            }

            const batch = filesArray.slice(i, i + MAX_BATCH_SIZE);
            const batchSize = batch.reduce((sum, f) => sum + f.size, 0);

            try {
                await Promise.all(
                    batch.map(file => limitThreads(async () => {
                        if (cancelProcessing) {
                            skipped++;
                            return;
                        }

                        // skip unsupported files
                        if (isSkippable(file)) {
                            skipped++;
                            await onFileProcessed({
                                name: file.name,
                                error: "File not processed: Unsupported media type"
                            });
                            return;
                        } else if (batchSize > MAX_BATCH_BYTES) {
                            throw new Error(`Total batch size exceeded the max limit (${MAX_BATCH_BYTES / (1000 * 1000)}MB)`);
                        }

                        const baseName = file.name.replace(/\.[^.]+$/, "");
                        const outputName = `${baseName}.webp`;

                        let blob;

                        try {
                            if (file.size > MAX_FILE_BYTES) {
                                throw new Error(`Image too big to process (greater than ${MAX_FILE_BYTES / (1000 * 1000)}MB)`);
                            }

                            if (!hqToggle.checked) {
                                // if size contraint enabled...
                                if (sizeToggle.checked) {
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
                            }

                            else {
                                // high quality compressing
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
            }
        }
    }

    if (gifFiles.length > 0) {
        setStatus("processing gif files now");
        let gi = 0;
        for (const file of gifFiles) {
            if (cancelProcessing) {
                skipped += gifFiles.length - gi;
                setStatus("stopped processing");
                break;
            }

            const baseName = file.name.replace(/\.[^.]+$/, "");
            const outputName = `${baseName}.webp`;

            let blob;

            try {
                if (file.size > MAX_FILE_BYTES) {
                    throw new Error(`GIF too big to process (greater than ${MAX_FILE_BYTES / (1000 * 1000)}MB)`);
                }

                if (sizeToggle.checked) {
                    blob = await processImageFrames({
                        file,
                        maxSize,
                        maxDims,
                        quality,
                        onProgress: (m) => setStatus(m)
                    });
                }

                else {
                    blob = await processImageFrames({
                        file,
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
                    error: e.message ?? "Error processing GIF"
                });
            } finally {
                gi++;
            }
        }
    }

    if (!cancelProcessing) setStatus("done");

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
        stopButton.classList.add("hidden");
        stopButton.classList.remove("loading");
        downloadAllWrapper.style.display = "flex";
        fileInputButton.disabled = false;
        folderInputButton.disabled = false;
        cancelProcessing = false;
    }, 1000);
}

registerHomeInit(initHome);
router();
