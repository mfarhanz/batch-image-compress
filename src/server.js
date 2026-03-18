import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import multer from "multer";
import pLimit from "p-limit";
import sharp from "sharp";
import fs from "fs";
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
		console.log(req, file, cb);
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
		files: 300,                 // max 500 files per request
	},
});


app.use(cors({ origin: process.env.VITE_CLIENT_URL }));
app.use(express.static("public"));
app.use("/output", express.static("output"));

// on nnormal exit
process.on("exit", cleanup);

// on CTRL+C
process.on("SIGINT", () => {
	console.log("\nServer shutting down");
	cleanup();
	process.exit();
});

// on kill commands
process.on("SIGTERM", () => {
	console.log("\nServer shutting down");
	cleanup();
	process.exit();
});

// on uncaught exceptions
process.on("uncaughtException", (err) => {
	console.error("Uncaught exception:", err);
	cleanup();
});

function cleanup() {
	safeRemoveDir(UPLOADS_DIR);
	safeRemoveDir(OUTPUT_DIR);
	console.log("Uploads and output folders emptied");
}

function safeRemoveDir(dirPath, retries = 5) {
	if (!fs.existsSync(dirPath)) return;

	try {
		fs.rmSync(dirPath, { recursive: true, force: true });
		console.log(`Deleted ${dirPath}`);
	} catch (err) {
		if (err.code === "EBUSY" && retries > 0) {
			console.warn(`Dir busy, retrying (${retries})...: ${dirPath}`);
			setTimeout(() => safeRemoveDir(dirPath, retries - 1), 1000);
		} else {
			console.error("Failed to remove dir:", dirPath, err);
		}
	}
}

function safeUnlink(filePath, retries = 5) {
	try {
		fs.unlinkSync(filePath);
	} catch (err) {
		if (err.code === "EBUSY" && retries > 0) {
			console.warn(`File busy, retrying (${retries}): ${filePath}`);
			setTimeout(() => safeUnlink(filePath, retries - 1), 1000);
		} else {
			console.error("Failed to delete file:", filePath, err);
		}
	}
}

// Helper to empty a directory
function emptyDir(dirPath) {
	if (!fs.existsSync(dirPath)) return;

	fs.readdirSync(dirPath).forEach(file => {
		const fullPath = path.join(dirPath, file);
		try {
			const stat = fs.statSync(fullPath);
			if (stat.isDirectory()) {
				safeRemoveDir(fullPath);
			} else {
				safeUnlink(fullPath);
			}
		} catch (err) {
			console.error("Error accessing:", fullPath, err);
		}
	});
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

	socket.on("disconnect", () => {
		console.log("Client disconnected:", socket.id);

		const uploadsDir = path.join(UPLOADS_DIR, socket.id);
		const outputDir = path.join(OUTPUT_DIR, socket.id);
		setTimeout(() => {
			[uploadsDir, outputDir].forEach(dir => {
				safeRemoveDir(dir);
			});
		}, 2000); // 2s buffer for file handles to release
	});
});

app.post("/upload", upload.array("images"), async (req, res) => {
	const files = req.files;
	try {
		const results = [];
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

		const outputDir = path.join(OUTPUT_DIR, clientId);
		// ensure directories exist
		[OUTPUT_DIR, outputDir].forEach(dir => ensureDir(dir));

		await Promise.all(
			files.map(file => limitThreads(async () => {
				const inputPath = file.path;

				// skip GIFs & videos
				if (isSkippable(file)) {
					fs.unlinkSync(inputPath);
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

					const fileResult = {
						name: outputFilename,
						url: `/output/${clientId}/${outputFilename}`,
						size: stats.size,
						oldSize: file.size
					};
					results.push(fileResult);
					socket?.emit("file-processed", fileResult);
				} catch (e) {
					errorCount++;
					results.push({
						name: file.originalname,
						error: "Could not process this image",
					});

				} finally {
					fs.unlink(inputPath, (err) => {
						if (err) console.error("Failed to delete input:", inputPath);
						else console.log(`done: ${inputPath}`);
					});
				}
			}))
		);

		res.json({ success: true, files: results, failed: errorCount });
	} catch (err) {
		res.status(500).json({ success: false, failed: files.length });
	}
});

server.listen(PORT, "0.0.0.0", () => {
	console.log(`Server listening on port ${PORT}`);
});
