import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import multer from "multer";
import pLimit from "p-limit";
import sharp from "sharp";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import cors from "cors";
import 'dotenv/config'

const app = express();
const PORT = process.env.PORT || 3000;
const UPLOADS_DIR = process.env.VITE_UPLOADS_DIR;
const OUTPUT_DIR = process.env.VITE_OUTPUT_DIR;
const limitThreads = pLimit(3); // max 3 concurrent tasks
const server = createServer(app);
const io = new Server(server, {
	transports: ["polling", "websocket"],
	cors: {
		origin: process.env.VITE_CLIENT_URL,
		methods: ["GET", "POST"],
	},
});

const storage = multer.diskStorage({
	destination: (req, file, cb) => {
		const clientId = req.body.clientId;
		if (!clientId) {
			return cb(new Error("Missing clientId"));
		}

		const dir = path.join("uploads", clientId);

		// create folder if it doesn't exist
		if (!fs.existsSync(dir)) {
			fs.mkdirSync(dir, { recursive: true });
		}

		cb(null, dir);
	},

	filename: (req, file, cb) => {
		const uniqueName = Date.now() + "-" + file.originalname;
		cb(null, uniqueName);
	}
});

const upload = multer({
	storage,
	limits: {
		fileSize: 100 * 1024 * 1024,  // max 100MB per file
		files: 300,                 // max 300 files per request
	},
});


app.use(cors({ origin: process.env.VITE_CLIENT_URL }));
app.use(express.static("public"));
app.use("/output", express.static("output"));

// on nnormal exit
process.on("exit", cleanup);

// on CTRL+C
process.on("SIGINT", async () => {
	console.log("\nServer shutting down");
	await cleanup();
	process.exit();
});

// on kill commands
process.on("SIGTERM", async () => {
	console.log("\nServer shutting down");
	await cleanup();
	process.exit();
});

// on uncaught exceptions
process.on("uncaughtException", async (err) => {
	console.error("Uncaught exception:", err);
	await cleanup();
});

async function cleanup() {
	await emptyDir(UPLOADS_DIR);
	await emptyDir(OUTPUT_DIR);
	console.log("Uploads and output folders emptied");
}

async function safeRemoveDir(dirPath, retries = 5) {
	try {
		await fsp.rm(dirPath, { recursive: true, force: true });
	} catch (err) {
		if (err.code === "EBUSY" && retries > 0) {
			await new Promise(res => setTimeout(res, 1000));
			return safeRemoveDir(dirPath, retries - 1);
		} else if (err.code !== "ENOENT") {
			console.error("Failed to remove dir:", dirPath, err);
		}
	}
}

async function safeUnlink(filePath, retries = 5) {
	try {
		await fsp.unlink(filePath);
	} catch (err) {
		if (err.code === "EBUSY" && retries > 0) {
			console.warn(`File busy, retrying (${retries}): ${filePath}`);
			await new Promise(res => setTimeout(res, 1000));
			return safeUnlink(filePath, retries - 1);
		} else if (err.code !== "ENOENT") {
			console.error("Failed to delete file:", filePath, err);
		}
	}
}

// Helper to empty a directory
async function emptyDir(dirPath) {
	try {
		const files = await fsp.readdir(dirPath);
		for (const file of files) {
			const fullPath = path.join(dirPath, file);
			const stat = await fsp.stat(fullPath);
			if (stat.isDirectory()) {
				await safeRemoveDir(fullPath);
			} else {
				await safeUnlink(fullPath);
			}
		}
	} catch (err) {
		if (err.code !== "ENOENT") {
			console.error("Failed to empty dir:", dirPath, err);
		}
		// ENOENT is fine — folder doesn't exist
	}
}

function ensureDir(dirPath) {
	if (!fs.existsSync(dirPath)) {
		fs.mkdirSync(dirPath, { recursive: true });
	}
}

const isSkippable = (file) => {
	return (
		file.mimetype === "image/gif" ||
		file.mimetype.startsWith("video/")
	);
};

// WebSocket connection
io.on("connection", (socket) => {
	console.log("Client connected:", socket.id);

	socket.on("disconnect", async () => {
		console.log("Client disconnected:", socket.id);

		const uploadsDir = path.join(UPLOADS_DIR, socket.id);
		const outputDir = path.join(OUTPUT_DIR, socket.id);

		// Wait for pending file handles to close
		await new Promise(res => setTimeout(res, 2000));

		// Delete client folders safely
		await Promise.all([safeRemoveDir(uploadsDir), safeRemoveDir(outputDir)]);

		console.log(`Deleted files uploaded from: ${socket.id}`);
	});
});

// app.post("/upload", upload.array("images"), async (req, res) => {
app.post("/upload", (req, res) => {
	const uploader = upload.array("images");

	uploader(req, res, async (err) => {
		if (err) {
			// multer errors
			if (err instanceof multer.MulterError) {
				const errorMap = {
					LIMIT_FILE_SIZE: "One or more files exceed 100MB limit",
					LIMIT_FILE_COUNT: "Too many files (max 300)",
				};

				const message = errorMap[err.code] || err.message;
				return res.status(400).json({
					success: false,
					error: message,
				});
			}

			// non-multer errors
			return res.status(500).json({
				success: false,
				error: err.message,
			});
		}

		const files = req.files;
		try {
			let errorCount = 0;
			let skipCount = 0;
			const rawMaxSize = parseInt(req.body.maxSize) || 1024;
			const maxSize = Math.min(Math.max(rawMaxSize, 1), 8000);
			const rawQuality = parseInt(req.body.quality) || 80;
			const quality = Math.min(Math.max(rawQuality, 10), 100);
			const clientId = req.body.clientId;

			if (!clientId) {
				return res.status(400).json({ success: false, error: "Missing clientId", failed: files.length });
			}
			const socket = io.sockets.sockets.get(clientId); // get the specific socket

			const outputDir = path.join(OUTPUT_DIR, clientId);
			// ensure directories exist
			[OUTPUT_DIR, outputDir].forEach(dir => ensureDir(dir));

			await Promise.all(
				files.map(file => limitThreads(async () => {
					const inputPath = file.path;

					// skip GIFs & videos
					if (isSkippable(file)) {
						skipCount++;
						fs.unlinkSync(inputPath);
						socket?.emit("file-processed", {
							name: file.originalname,
							error: "File not processed: Unsupported media type",
						});
						return;
					}

					try {
						const baseName = path.parse(file.originalname).name;
						const outputFilename = `${Date.now()}-${baseName}.webp`;
						const outputPath = path.join(outputDir, outputFilename);

						await sharp(inputPath)
							.resize({
								width: maxSize,
								height: maxSize,
								fit: "inside",
								withoutEnlargement: true,
							})
							.webp({ quality: quality })
							.toFile(outputPath);

						const stats = fs.statSync(outputPath);

						socket?.emit("file-processed", {
							name: outputFilename,
							url: `/output/${clientId}/${outputFilename}`,
							size: stats.size,
							oldSize: file.size
						});
					} catch (e) {
						errorCount++;
						socket?.emit("file-processed", {
							name: file.originalname,
							error: "Error processing image",
						});
					} finally {
						fs.unlink(inputPath, (err) => {
							if (err) console.error("Failed to delete input:", inputPath);
						});
					}
				}))
			);

			return res.json({ success: true, failed: errorCount, skipped: skipCount });
		} catch (err) {
			return res.status(500).json({ success: false, error: "Internal server error", failed: files.length, skipped: skipCount });
		}
	});
});

server.listen(PORT, "0.0.0.0", () => {
	console.log(`Server listening on port ${PORT}`);
});
