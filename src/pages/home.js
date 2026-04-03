export default `
<h2>Batch Image Compressor to WebP</h2>

        <p class="description">
            Compress multiple images at once by converting them to
            <a target="_blank" rel="noopener noreferrer" class="link"
                href="https://developers.google.com/speed/webp#:~:text=WebP%20lossless%20images,GIF%20and%20APNG.">WebP</a>
            directly in your browser.<br>
            Supported formats: PNG, JPG, JPEG, BMP, TIFF, GIF, AVIF.
        </p>

        <div class="main-container">
            <div class="left-panel">
                <!-- Upload sections go here -->
                <div class="upload-section">
                    <label for="fileInput">Select individual image files:</label>
                    <input type="file" id="fileInput" accept="image/*,.gif" multiple />
                    <button id="fileInputButton">Upload Files</button>
                </div>

                <div id="folder-upload" class="upload-section">
                    <label for="folderInput">Or select a folder of images:</label>
                    <input type="file" id="folderInput" webkitdirectory accept="image/*,.gif" />
                    <button id="folderInputButton">Upload Folder</button>
                </div>
            </div>

            <div class="right-panel">
                <!-- Image Settings (enabled by default) -->
                <div class="settings-card enabled" id="imageSettingsCard">
                    <div class="settings-header">
                        <span>Image Settings</span>
                        <label class="switch">
                            <input type="checkbox" id="toggleImageSettings" checked>
                            <span class="slider"></span>
                        </label>
                    </div>

                    <div class="settings-content">
                        <div class="settings-item">
                            <label for="maxDims">Max width/height (px):</label>
                            <input type="number" id="maxDims" value="1024" min="1" max="8000">
                        </div>

                        <div class="settings-item">
                            <label for="quality">
                                Image quality (1-100):
                                <span id="qualityValue">80</span>
                            </label>
                            <input type="range" id="quality" class="range-modern" value="80" min="1" max="100">

                        </div>
                    </div>
                </div>

                <!-- File Settings -->
                <div class="settings-card disabled" id="sizeLimitCard">
                    <div class="settings-header">
                        <span>File Settings</span>
                        <label class="switch">
                            <input type="checkbox" id="toggleSizeLimit">
                            <span class="slider"></span>
                        </label>
                    </div>

                    <div class="settings-content">
                        <div class="settings-item">
                            <label for="maxFileSize">
                                Max file size:
                                <span id="sizeValue">500 KB</span>
                            </label>

                            <input type="range" id="maxFileSize" class="range-modern" min="50" max="5000" step="50"
                                value="500">
                            <div class="size-scale">
                                <span>50 KB</span>
                                <span>1 MB</span>
                                <span>2 MB</span>
                                <span>3 MB</span>
                                <span>4 MB</span>
                                <span>5 MB</span>
                            </div>
                        </div>
                    </div>

                    <div id="fsInfo" class="fs-info notice hidden">
                        Files may not always stay within the selected limit, especially GIFs
                    </div>
                </div>

                <!-- High Quality toggle -->
                <div class="hq-toggle-row">
                    <span>High Quality Compression</span>
                    <label class="switch">
                        <input type="checkbox" id="hqToggle">
                        <span class="slider"></span>
                    </label>
                </div>
                <div id="hqWarning" class="hq-warning notice hidden">
                    Enabling this improves image quality but may increase processing time
                </div>

            </div>
        </div>

        <hr>

        <div id="results"></div>
        <div id="statusBar" class="hidden">Ready</div>
        <div id="progressBar"></div>
        <div id="error-card" style="display:none;">
            <div id="error-header">
                <span id="error-message"></span>
                <span id="error-arrow">▼</span>
            </div>
            <div id="error-info"></div>
            <div id="error-list"></div>
        </div>
        <div id="summary"></div>
        <div id="download-zip-wrapper">
            <button id="download-zip-btn">Download All as ZIP
                <div id="zip-progress"></div>
            </button>
        </div>
        <button id="stop-btn" class="hidden">
            <span class="stop-text">⏹</span>
            <span class="stop-spinner"></span>
        </button>
`