import { io } from "socket.io-client";
import JSZip from "jszip";

const serverUrl = import.meta.env.VITE_SERVER_URL;
const resultsDiv = document.getElementById("results");
const qualitySlider = document.getElementById("quality");
const qualityValue = document.getElementById("qualityValue");
const folderInput = document.getElementById("folderInput");
const fileInput = document.getElementById("fileInput");
const fileInputButton = document.getElementById("fileInputButton");
const folderInputButton = document.getElementById("folderInputButton");
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

const socket = io(serverUrl);
const MAX_BATCH_SIZE = 20;

let completedFiles = 0; // for progress bar across all batches
let totalFiles = 0;
let fileBuffer = [];
let failedFiles = [];

socket.on("connect", () => {
    console.log("Connected to server with Socket ID:", socket.id);
});

socket.on("file-processed", async (data) => {
    // Convert base64 buffer to Blob
    let blobUrl = null;
    if (data.buffer) {
        const binary = Uint8Array.from(atob(data.buffer), c => c.charCodeAt(0));
        const blob = new Blob([binary], { type: "image/webp" });
        blobUrl = URL.createObjectURL(blob);

        // Store blob for later download/all-download
        fileBuffer.push({
            name: data.name,
            blob,
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
    // tiny delay to let UI render smoothly (optional)
    await new Promise(r => setTimeout(r, 50));
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
    // URL.revokeObjectURL(url);

    zipProgressBar.animate(1);
    // Hide after done
    setTimeout(() => {
        zipProgressContainer.classList.remove("show");
        downloadAll.disabled = false;
    }, 2000);
});

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

export async function handleUpload(files) {
    if (!files.length) return;

    clearBuffers();
    clearUI();
    fileInputButton.disabled = true;
    folderInputButton.disabled = true;
    progressBar.style.display = "block"; // show
    progressBar.classList.add("progress-shimmer");

    let errorMessage;
    let failed = 0;
    let skipped = 0;
    completedFiles = 0;
    totalFiles = files.length;

    // loop through batches
    for (let i = 0; i < files.length; i += MAX_BATCH_SIZE) {
        const batch = Array.from(files).slice(i, i + MAX_BATCH_SIZE);
        const formData = new FormData();
        formData.append("clientId", socket.id);
        batch.forEach(file => formData.append("images", file));

        // add current settings
        formData.append("maxSize", document.getElementById("maxSize").value);
        formData.append("quality", document.getElementById("quality").value);

        try {
            const res = await fetch(`${serverUrl}/upload`, { method: "POST", body: formData });
            const data = await res.json();
            if (data?.skipped != null) {
                skipped += data.skipped;
            }
            if (!data.success) {
                let err;
                if (data?.failed != null) {
                    failed += data.failed;
                    err = new Error(`Error processing files. ${data.error}.`);
                } else {
                    failed += batch.length;
                    err = new Error(`Batch upload failed. ${data.error}.`);
                }
                err.type = "server";
                throw err;
            } else failed += data.failed;
        } catch (err) {
            failedFiles.push(...batch);

            if (err.type === "server") {
                console.error("Server error:", err.message);
                errorMessage = err.message;
            } else {
                failed += batch.length
                console.error("Network/client error:", err.message);
                errorMessage = err.message;
            }
        }
    }

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
        downloadAllWrapper.style.display = "flex";
        fileInputButton.disabled = false;
        folderInputButton.disabled = false;
    }, 1000);
}
