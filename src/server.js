import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import multer from "multer";
import pLimit from "p-limit";
import sharp from "sharp";
// import fs from "fs";
// import fsp from "fs/promises";
import path from "path";
import cors from "cors";
import 'dotenv/config'

const app = express();
const PORT = process.env.PORT || 3000;
const MAX_BATCH_SIZE = 300 * 1024 * 1024; // 300MB total per batched request
const limitThreads = pLimit(3); // max 3 concurrent tasks
const server = createServer(app);
const io = new Server(server, {
	transports: ["polling", "websocket"],
	cors: {
		origin: process.env.VITE_CLIENT_URL,
		methods: ["GET", "POST"],
	},
});

const storage = multer.memoryStorage();

const upload = multer({
	storage,
	limits: {
		fileSize: 100 * 1024 * 1024,  // max 100MB per file
		files: 20,                 // max 20 files per batched request
	},
});


app.use(cors({ origin: process.env.VITE_CLIENT_URL }));
app.use(express.static("public"));
app.use("/output", express.static("output"));

// on CTRL+C
process.on("SIGINT", async () => {
	console.log("\nServer shutting down");
	process.exit();
});

// on kill commands
process.on("SIGTERM", async () => {
	console.log("\nServer shutting down");
	process.exit();
});

// on uncaught exceptions
process.on("uncaughtException", async (err) => {
	console.error("Uncaught exception:", err);
});

const isSkippable = (file) => {
	return (
		file.mimetype.startsWith("video/")
	);
};

// WebSocket connection
io.on("connection", (socket) => {
	console.log("Client connected:", socket.id);

	socket.on("disconnect", async () => {
		console.log("Client disconnected:", socket.id);

		// Wait for pending file handles to close
		await new Promise(res => setTimeout(res, 2000));
		console.log(`Deleted files uploaded from: ${socket.id}`);
	});
});

// async function processImageCanvas({ file, maxSize, quality }) {
// 	const bitmap = await createImageBitmap(file);

// 	const scale = Math.min(
// 		1,
// 		maxSize / bitmap.width,
// 		maxSize / bitmap.height
// 	);

// 	const width = Math.round(bitmap.width * scale);
// 	const height = Math.round(bitmap.height * scale);

// 	const canvas = new OffscreenCanvas(width, height);
// 	const ctx = canvas.getContext("2d");

// 	ctx.drawImage(bitmap, 0, 0, width, height);

// 	const blob = await canvas.convertToBlob({
// 		type: "image/webp",
// 		quality: quality / 100
// 	});

// 	return blob;
// }

async function processImageSharp({ inputBuffer, maxSize, quality }) {
	// Sharp reads from the file path, returns buffer in memory
	return await sharp(inputBuffer, { animated: true })
		.resize({
			width: maxSize,
			height: maxSize,
			fit: "inside",
			withoutEnlargement: true,
		})
		.webp({ quality })
		.toBuffer();
}

app.post("/upload", (req, res) => {
	const uploader = upload.array("images");

	uploader(req, res, async (err) => {
		if (err) {
			// multer errors
			if (err instanceof multer.MulterError) {
				const errorMap = {
					LIMIT_FILE_SIZE: "One or more files exceed 100MB limit",
					LIMIT_FILE_COUNT: "Too many files (max 20)",
				};

				const message = errorMap[err.code] || err.message;
				return res.status(400).json({
					success: false,
					error: message,
				});
			}

			// non-multer errors
			return res.status(408).json({
				success: false,
				error: err.message,
			});
		}

		const files = req.files;
		let skipCount = 0;
		try {
			// total upload size check
			const batchSize = files.reduce((sum, file) => sum + file.size, 0);
			if (batchSize > MAX_BATCH_SIZE) {
				return res.status(413).json({
					success: false,
					error: "Total upload size exceeded (max 500MB)"
				});
			}

			let errorCount = 0;
			const rawMaxSize = parseInt(req.body.maxSize) || 1024;
			const maxSize = Math.min(Math.max(rawMaxSize, 1), 8000);
			const rawQuality = parseInt(req.body.quality) || 80;
			const quality = Math.min(Math.max(rawQuality, 10), 100);
			const clientId = req.body.clientId;

			if (!clientId) {
				return res.status(400).json({ success: false, error: "Missing clientId", failed: files.length });
			}
			const socket = io.sockets.sockets.get(clientId); // get the specific socket

			await Promise.all(
				files.map(file => limitThreads(async () => {
					const inputBuffer = file.buffer;

					// skip unsupported mime formats
					if (isSkippable(file)) {
						skipCount++;
						socket?.emit("file-processed", {
							name: file.originalname,
							error: "File not processed: Unsupported media type",
						});
						return;
					}

					try {
						const baseName = path.parse(file.originalname).name;
						const outputFilename = `${Date.now()}-${baseName}.webp`;

						const outputBuffer = await processImageSharp({
							inputBuffer,
							maxSize,
							quality
						});

						socket?.emit("file-processed", {
							name: outputFilename,
							originalName: file.originalname,
							buffer: outputBuffer.toString("base64"),
							size: outputBuffer.length,
							oldSize: file.size
						});
					} catch {
						errorCount++;
						socket?.emit("file-processed", {
							name: file.originalname,
							error: "Error processing image",
						});
					}
				}))
			);

			return res.json({ success: true, failed: errorCount, skipped: skipCount });
		} catch {
			return res.status(500).json({ success: false, error: "Internal server error", failed: files.length, skipped: skipCount });
		}
	});
});

server.listen(PORT, "0.0.0.0", () => {
	console.log(`Server listening on port ${PORT}`);
});
