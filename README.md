# Batch Image Compressor

A small tool that can be run locally to upload multiple images (or entire folders), efficiently resize them by convert to WebP and adjusting image quality/dimensions, and download the results.

## Features

- Upload individual files or full folders
- Batch processing with size and quality controls
- Converts images to WebP
- Skips unsupported formats (GIFs, videos)
- Real-time progress updates
- Preview and download processed images

## Tech Stack

- Frontend: Vite (vanilla JS)
- Backend: Node.js + Express
- Image processing: Sharp
- File uploads: Multer
- Realtime updates: Socket.IO

## Getting Started

### 1. Install dependencies

```bash
npm install
````

### 2. Set up environment variables

Create a `.env` file:

```env
VITE_SERVER_URL=http://localhost:3000
VITE_CLIENT_URL=http://localhost:5173
VITE_UPLOADS_DIR=uploads
VITE_OUTPUT_DIR=output
```

### 3. Run the app

Start the backend:

```bash
npm run serve
```

Start the frontend:

```bash
npm run dev
```

Then open the Vite URL (usually `http://localhost:5173`).

## Project Structure

```
├── public/        # static assets
├── src/           # frontend + server code
├── uploads/       # temporary uploaded files
├── output/        # processed images
├── server.js
```

## Notes

- Uploaded and processed files are stored locally and cleared on server shutdown.
- Large uploads are processed in batches to avoid memory issues.
- Progress updates are sent in real time using WebSockets.

## Limitations

- Not optimized for production deployment yet
- Uses local file storage (not cloud)
- No authentication or user separation

## Future Improvements

- Cloud storage (S3 / Cloudflare R2)
- Drag-and-drop UI
- Better error handling and retry logic
- Deployable backend setup
