const express = require("express");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const path = require("path");
const multer = require("multer");
const fs = require("fs");
const app = express();

app.use(express.json());
app.use(express.static("public"));
app.use("/uploads", express.static("uploads"));

const MONGO_URL = "mongodb+srv://dabcholi6_db_user:cvueDzp1DzUB6bCb@my-server-db.z2uaxrx.mongodb.net/my-server-db?retryWrites=true&w=majority";
const JWT_SECRET = "my_super_secret_key_1403";

const AdminSchema = new mongoose.Schema({ email: String, password: String });
const Admin = mongoose.model("Admin", AdminSchema);
const UserSchema = new mongoose.Schema({ name: String, phone: String, email: String, password: String, isActive: { type: Boolean, default: true }, createdAt: { type: Date, default: Date.now } });
const User = mongoose.model("User", UserSchema);
const BundleSchema = new mongoose.Schema({ title: String, description: String, code: String, isActive: { type: Boolean, default: true }, createdAt: { type: Date, default: Date.now } });
const Bundle = mongoose.model("Bundle", BundleSchema);
const VideoSchema = new mongoose.Schema({ bundleId: { type: mongoose.Schema.Types.ObjectId, ref: "Bundle" }, title: String, order: Number, filename: String, filePath: String, createdAt: { type: Date, default: Date.now } });
const Video = mongoose.model("Video", VideoSchema);
const AccessCodeSchema = new mongoose.Schema({ bundleId: { type: mongoose.Schema.Types.ObjectId, ref: "Bundle" }, userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" }, code: String, isUsed: { type: Boolean, default: false }, usedAt: Date, expiresAt: Date, isActive: { type: Boolean, default: true }, createdAt: { type: Date, default: Date.now } });
const AccessCode = mongoose.model("AccessCode", AccessCodeSchema);

mongoose.connect(MONGO_URL).then(async () => { console.log("MongoDB OK"); const a = await Admin.findOne({ email: "admin@admin.com" }); if (!a) { const h = await bcrypt.hash("123456", 10); await Admin.create({ email: "admin@admin.com", password: h }); } }).catch(e => console.log(e));

const authMiddleware = async (req, res, next) => { try { const t = req.headers.authorization?.split(" ")[1]; if (!t) return res.status(401).json({ error: "Unauthorized" }); jwt.verify(t, JWT_SECRET); next(); } catch (e) { res.status(401).json({ error: "Invalid token" }); } };

const storage = multer.diskStorage({ destination: "uploads/", filename: (req, f, cb) => cb(null, Date.now() + "-" + f.originalname) });
const upload = multer({ storage, limits: { fileSize: 2000 * 1024 * 1024 } });

app.post("/api/admin/login", async (req, res) => { const { email, password } = req.body; const a = await Admin.findOne({ email }); if (!a) return res.status(401).json({ error: "Wrong" }); const m = await bcrypt.compare(password, a.password); if (!m) return res.status(401).json({ error: "Wrong" }); res.json({ token: jwt.sign({ id: a._id }, JWT_SECRET, { expiresIn: "24h" }) }); });
app.get("/api/bundles", authMiddleware, async (req, res) => res.json(await Bundle.find().sort({ createdAt: -1 })));
app.post("/api/bundles", authMiddleware, async (req, res) => { const { title, description } = req.body; const b = await Bundle.create({ title, description, code: "BNDL-" + Math.random().toString(36).substring(2, 8).toUpperCase() }); res.json(b); });
app.delete("/api/bundles/:id", authMiddleware, async (req, res) => { await Bundle.findByIdAndDelete(req.params.id); await Video.deleteMany({ bundleId: req.params.id }); await AccessCode.deleteMany({ bundleId: req.params.id }); res.json({ message: "Deleted" }); });
app.post("/api/videos", authMiddleware, upload.single("video"), async (req, res) => { const { bundleId, title, order } = req.body; const v = await Video.create({ bundleId, title, order: order || 1, filename: req.file.originalname, filePath: "/uploads/" + req.file.filename }); res.json({ message: "Uploaded!", video: v }); });
app.get("/api/bundles/:id/videos", async (req, res) => res.json(await Video.find({ bundleId: req.params.id }).sort({ order: 1 })));
app.get("/stream/:id", async (req, res) => { const v = await Video.findById(req.params.id); if (!v) return res.status(404).json({ error: "Not found" }); const p = path.join(__dirname, v.filePath); fs.existsSync(p) ? res.sendFile(p) : res.status(404).json({ error: "Not found" }); });
app.post("/api/users/register", async (req, res) => { const { name, phone, email, password } = req.body; if (await User.findOne({ $or: [{ email }, { phone }] })) return res.status(400).json({ error: "Exists" }); const h = await bcrypt.hash(password, 10); const u = await User.create({ name, phone, email, password: h }); res.json({ token: jwt.sign({ id: u._id }, JWT_SECRET, { expiresIn: "30d" }), user: { id: u._id, name: u.name } }); });
app.post("/api/users/login", async (req, res) => { const { email, password } = req.body; const u = await User.findOne({ $or: [{ email }, { phone: email }] }); if (!u) return res.status(401).json({ error: "Not found" }); if (!u.isActive) return res.status(401).json({ error: "Disabled" }); if (!await bcrypt.compare(password, u.password)) return res.status(401).json({ error: "Wrong" }); res.json({ token: jwt.sign({ id: u._id }, JWT_SECRET, { expiresIn: "30d" }), user: { id: u._id, name: u.name } }); });
app.get("/api/my-bundles", async (req, res) => { const t = req.headers.authorization?.split(" ")[1]; if (!t) return res.status(401).json({ error: "Unauthorized" }); const d = jwt.verify(t, JWT_SECRET); const codes = await AccessCode.find({ userId: d.id, isActive: true, isUsed: true }).populate("bundleId"); res.json(codes.map(c => c.bundleId).filter(b => b)); });
app.post("/api/activate-code", async (req, res) => { const t = req.headers.authorization?.split(" ")[1]; if (!t) return res.status(401).json({ error: "Unauthorized" }); const d = jwt.verify(t, JWT_SECRET); const { code } = req.body; const ac = await AccessCode.findOne({ code, isActive: true }); if (!ac) return res.status(400).json({ error: "کد نامعتبر!" }); if (ac.userId.toString() !== d.id) return res.status(403).json({ error: "این کد مال شما نیست!" }); if (ac.isUsed) return res.status(400).json({ error: "کد قبلاً استفاده شده!" }); if (ac.expiresAt && new Date(ac.expiresAt) < new Date()) return res.status(400).json({ error: "کد منقضی شده!" }); ac.isUsed = true; ac.usedAt = new Date(); await ac.save(); res.json({ message: "✅ کد فعال شد!", bundleId: ac.bundleId }); });
app.get("/api/users", authMiddleware, async (req, res) => res.json(await User.find().sort({ createdAt: -1 })));
app.get("/api/access-codes", authMiddleware, async (req, res) => res.json(await AccessCode.find().populate("bundleId").populate("userId").sort({ createdAt: -1 })));
app.post("/api/access-codes", authMiddleware, async (req, res) => { const { bundleId, userId, expiresAt } = req.body; if (await AccessCode.findOne({ bundleId, userId, isActive: true })) return res.status(400).json({ error: "Already exists!" }); const ac = await AccessCode.create({ bundleId, userId, code: "VIP-" + Math.random().toString(36).substring(2, 10).toUpperCase(), expiresAt: expiresAt || null }); res.json(ac); });
app.get("/sw.js", (req, res) => res.sendFile(path.join(__dirname, "public", "sw.js")));
app.get("/", (req, res) => res.send("OK"));

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log("Port " + PORT));