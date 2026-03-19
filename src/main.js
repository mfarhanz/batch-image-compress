import { io } from "socket.io-client";
import JSZip from "jszip";

// const SIZE_LIMIT = 200000; // 200 KB
const serverUrl = import.meta.env.VITE_SERVER_URL;
const resultsDiv = document.getElementById("results");
const qualitySlider = document.getElementById("quality");
const qualityValue = document.getElementById("qualityValue");
const folderInput = document.getElementById("folderInput");
const fileInput = document.getElementById("fileInput");
const progressBar = document.getElementById("progressBar");
const summary = document.getElementById("summary");
const downloadAll = document.getElementById("download-zip-btn");
const downloadAllWrapper = document.getElementById("download-zip-wrapper");
const zipProgressContainer = document.getElementById("zip-progress");
const zipProgressBar = new ProgressBar.Circle(zipProgressContainer, {
    strokeWidth: 6,
    color: "#c7d2fe",
    trailColor: "#e5e7eb",
    trailWidth: 6,
    easing: "easeInOut",
    duration: 300,
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

let completedFiles = 0; // for progress bar across all batches
let totalFiles = 0;
let fileBuffer = [];

socket.on("connect", () => {
    console.log("Connected to server via WebSocket:", socket.id);
});

socket.on("file-processed", async (file) => {
    const el = createFileItem(file);
    resultsDiv.appendChild(el);
    window.scrollTo({
        top: document.body.scrollHeight,
        behavior: "smooth"
    });
    // Update progress bar incrementally
    completedFiles++;
    fileBuffer.push(file?.url);
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
    await Promise.all(fileBuffer.map(async (url, index) => {
        try {
            const response = await fetch(url);
            const blob = await response.blob();
            const filename = url.substring(url.lastIndexOf("/") + 1);
            folder.file(filename, blob);
        } catch (err) {
            console.error("Failed to fetch file:", url, err);
        } finally {
            completed++;
            const percent = completed / total;
            zipProgressBar.animate(percent); // smooth animation
        }
    }));

    // Generate zip and trigger download
    zip.generateAsync({ type: "blob" }).then((content) => {
        const link = document.createElement("a");
        link.href = URL.createObjectURL(content);
        link.download = "files.zip";
        link.click();
        URL.revokeObjectURL(link.href);
    });

    zipProgressBar.animate(1);
    // Hide after done
    setTimeout(() => {
        zipProgressContainer.classList.remove("show");
        downloadAll.disabled = false;
    }, 2000);
});

function clearUI() {
    resultsDiv.innerHTML = "";
    summary.style.display = "none";
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

document.getElementById("fileInputButton").addEventListener("click", () => {
    const input = document.getElementById("fileInput");
    handleUpload(input.files);
});

document.getElementById("folderInputButton").addEventListener("click", () => {
    const input = document.getElementById("folderInput");
    handleUpload(input.files);
});

const formatSize = (bytes) => {
    if (bytes > 1024 * 1024)
        return (bytes / (1024 * 1024)).toFixed(2) + " MB";
    if (bytes > 1024)
        return (bytes / 1024).toFixed(2) + " KB";
    return bytes + " B";
};

export async function handleUpload(files) {
    if (!files.length) return;

    clearUI();
    progressBar.style.display = "block"; // show

    const batchSize = 50; // max files per request
    let failed = 0;
    let skipped = 0;
    completedFiles = 0;
    totalFiles = files.length;

    // loop through batches
    for (let i = 0; i < files.length; i += batchSize) {
        const batch = Array.from(files).slice(i, i + batchSize);
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
                completedFiles -= skipped;
            }
            if (!data.success) {
                if (data?.failed != null) {
                    failed += data.failed;
                    throw new Error(`Error processing file: ${data.error}`);
                } else {
                    failed += batch.length;
                    throw new Error(`Batch upload failed: ${data.error}`);
                }
            } else failed += data.failed;
        } catch (err) {
            console.error(err);
        }
    }

    summary.textContent = `(Processed ${completedFiles}/${totalFiles} files • ${failed} failed • ${skipped} skipped)`;
    summary.style.display = "block";
    // done processing all batches
    progressBar.style.backgroundColor = "#2ecc71";
    downloadAllWrapper.style.display = "flex";
}