import { io } from "socket.io-client";

// const SIZE_LIMIT = 200000; // 200 KB
const serverUrl = import.meta.env.VITE_SERVER_URL;
const resultsDiv = document.getElementById("results");
const qualitySlider = document.getElementById("quality");
const qualityValue = document.getElementById("qualityValue");
const folderInput = document.getElementById("folderInput");
const fileInput = document.getElementById("fileInput");
const progressBar = document.getElementById("progressBar");
const summary = document.getElementById("summary");
const socket = io(serverUrl);

let completedFiles = 0; // for progress bar across all batches
let totalFiles = 0;

socket.on("connect", () => {
    console.log("Connected to server via WebSocket:", socket.id);
});

socket.on("file-processed", async (file) => {
    console.log("Received processed file:", file);
    const el = createFileItem(file);
    resultsDiv.appendChild(el);
    window.scrollTo({
        top: document.body.scrollHeight,
        behavior: "smooth"
    });
    // Update progress bar incrementally
    completedFiles++;
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

function clearUI() {
    resultsDiv.innerHTML = "";
    summary.style.display = "none";
    progressBar.style.display = "none";
}

function createFileItem(file) {
    const container = document.createElement("div");

    const title = document.createElement("div");

    // only on rror/corrupted/unsupported files
    if (file.error) {
        title.textContent = `${file.name} - ${file.error}`;
        title.style.color = "red";
        container.appendChild(title);
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

    title.className = "file-item";
    title.appendChild(nameSpan);   // LEFT
    title.appendChild(rightSide);  // RIGHT

    const details = document.createElement("div");
    details.className = "details";
    const img = document.createElement("img");
    img.src = file.url;
    details.appendChild(img);

    // toggle behavior
    title.onclick = () => {
        details.style.display =
            details.style.display === "none" ? "block" : "none";
    };

    container.appendChild(title);
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
    progressBar.style.width = "0%";      // reset
    progressBar.style.display = "block"; // show

    const batchSize = 50; // max files per request
    let failed = 0;
    completedFiles = 0;
    totalFiles = files.length;
    // let allFiles = []; // collect results from all batches

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
            failed += data.failed;
            if (!data.success) continue;
        } catch (err) {
            console.error("Batch upload failed", err);
            failed += batch.length;
        }
    }

    summary.textContent = `(Processed ${completedFiles}/${totalFiles} files • ${failed} failed)`;
    summary.style.display = "block";
    // done processing all batches
    progressBar.style.display = "none";
}