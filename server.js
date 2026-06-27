const express = require("express");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const path = require("path");
const multer = require("multer");
const { exec } = require("child_process");
const fs = require("fs");
const app = express();

app.use(express.json());
app.use(express.static("public"));

const MONGO_URL = "mongodb+srv://dabcholi6_db_user:cvueDzp1DzUB6bCb@my-server-db.z2uaxrx.mongodb.net/my-server-db?retryWrites=true&w=majority";
const JWT_SECRET = "my_super_secret_key_1403";

const AdminSchema = new mongoose.Schema({ email: String, password: String });
const Admin = mongoose.model("Admin", AdminSchema);

const UserSchema = new mongoose.Schema({
  name: String, phone: String, email: String, password: String,
  deviceId: String, isActive: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now }
});
const User = mongoose.model("User", UserSchema);

const BundleSchema = new mongoose.Schema({
  title: String, description: String, code: String,
  isActive: { type: Boolean, default: true }, createdAt: { type: Date, default: Date.now }
});
const Bundle = mongoose.model("Bundle", BundleSchema);

const VideoSchema = new mongoose.Schema({
  bundleId: { type: mongoose.Schema.Types.ObjectId, ref: "Bundle" },
  title: String, order: Number, filename: String, hlsPath: String,
  createdAt: { type: Date, default: Date.now }
});
const Video = mongoose.model("Video", VideoSchema);

const AccessCodeSchema = new mongoose.Schema({
  bundleId: { type: mongoose.Schema.Types.ObjectId, ref: "Bundle" },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  code: String, deviceId: String, isUsed: { type: Boolean, default: false },
  usedAt: Date, expiresAt: Date, isActive: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now }
});
const AccessCode = mongoose.model("AccessCode", AccessCodeSchema);

mongoose.connect(MONGO_URL)
  .then(async () => {
    console.log("MongoDB connected!");
    const existingAdmin = await Admin.findOne({ email: "admin@admin.com" });
    if (!existingAdmin) {
      const hashedPassword = await bcrypt.hash("123456", 10);
      await Admin.create({ email: "admin@admin.com", password: hashedPassword });
    }
  })
  .catch(err => console.log("MongoDB error:", err));

const authMiddleware = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) return res.status(401).json({ error: "Unauthorized" });
    const decoded = jwt.verify(token, JWT_SECRET);
    req.adminId = decoded.id;
    next();
  } catch (err) { res.status(401).json({ error: "Invalid token" }); }
};

const storage = multer.diskStorage({
  destination: "/tmp/uploads",
  filename: (req, file, cb) => cb(null, Date.now() + "-" + file.originalname)
});
const upload = multer({ storage, limits: { fileSize: 2000 * 1024 * 1024 } });

// ==================== ADMIN ====================
app.post("/api/admin/login", async (req, res) => {
  const { email, password } = req.body;
  const admin = await Admin.findOne({ email });
  if (!admin) return res.status(401).json({ error: "Wrong email or password" });
  const isMatch = await bcrypt.compare(password, admin.password);
  if (!isMatch) return res.status(401).json({ error: "Wrong email or password" });
  const token = jwt.sign({ id: admin._id }, JWT_SECRET, { expiresIn: "24h" });
  res.json({ token });
});

// ==================== BUNDLES ====================
app.get("/api/bundles", authMiddleware, async (req, res) => {
  const bundles = await Bundle.find().sort({ createdAt: -1 });
  res.json(bundles);
});
app.post("/api/bundles", authMiddleware, async (req, res) => {
  const { title, description } = req.body;
  const code = "BNDL-" + Math.random().toString(36).substring(2, 8).toUpperCase();
  const bundle = await Bundle.create({ title, description, code });
  res.json(bundle);
});
app.delete("/api/bundles/:id", authMiddleware, async (req, res) => {
  await Bundle.findByIdAndDelete(req.params.id);
  await Video.deleteMany({ bundleId: req.params.id });
  await AccessCode.deleteMany({ bundleId: req.params.id });
  res.json({ message: "Deleted" });
});

// ==================== VIDEOS ====================
app.post("/api/videos", authMiddleware, upload.single("video"), async (req, res) => {
  try {
    const { bundleId, title, order } = req.body;
    const filePath = req.file.path;
    const videoId = new mongoose.Types.ObjectId();
    const outputDir = `/tmp/videos/${videoId}`;
    const hlsPath = `${outputDir}/master.m3u8`;
    
    fs.mkdirSync(outputDir, { recursive: true });
    
    const cmd = `ffmpeg -i ${filePath} -c:v libx264 -c:a aac -hls_time 6 -hls_list_size 0 -hls_segment_filename ${outputDir}/seg_%03d.ts ${hlsPath}`;
    
    exec(cmd, { timeout: 300000 }, async (error, stdout, stderr) => {
      if (error) {
        console.log("FFmpeg error:", stderr);
        return res.status(500).json({ error: "Conversion failed" });
      }
      const video = await Video.create({ _id: videoId, bundleId, title, order: order || 1, filename: req.file.originalname, hlsPath });
      res.json({ message: "Uploaded!", video });
    });
  } catch (err) { res.status(500).json({ error: "Upload failed" }); }
});

app.get("/api/bundles/:id/videos", async (req, res) => {
  const videos = await Video.find({ bundleId: req.params.id }).sort({ order: 1 });
  res.json(videos);
});

app.delete("/api/videos/:id", authMiddleware, async (req, res) => {
  const video = await Video.findByIdAndDelete(req.params.id);
  if (video?.hlsPath) exec(`rm -rf ${video.hlsPath.replace("/master.m3u8", "")}`);
  res.json({ message: "Deleted" });
});

app.get("/stream/:videoId/*", (req, res) => {
  const p = `/tmp/videos/${req.params.videoId}/${req.params[0]}`;
  if (fs.existsSync(p)) {
    res.setHeader("Accept-Ranges", "bytes");
    res.sendFile(p);
  } else res.status(404).json({ error: "Not found" });
});

// ==================== USERS ====================
app.post("/api/users/register", async (req, res) => {
  const { name, phone, email, password } = req.body;
  const existing = await User.findOne({ $or: [{ email }, { phone }] });
  if (existing) return res.status(400).json({ error: "User exists" });
  const hashedPassword = await bcrypt.hash(password, 10);
  const user = await User.create({ name, phone, email, password: hashedPassword });
  const token = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: "30d" });
  res.json({ token, user: { id: user._id, name: user.name } });
});

app.post("/api/users/login", async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ $or: [{ email }, { phone: email }] });
  if (!user) return res.status(401).json({ error: "User not found" });
  if (!user.isActive) return res.status(401).json({ error: "Disabled" });
  const isMatch = await bcrypt.compare(password, user.password);
  if (!isMatch) return res.status(401).json({ error: "Wrong password" });
  const token = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: "30d" });
  res.json({ token, user: { id: user._id, name: user.name } });
});

app.get("/api/my-bundles", async (req, res) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Unauthorized" });
  const decoded = jwt.verify(token, JWT_SECRET);
  const codes = await AccessCode.find({ userId: decoded.id, isActive: true, isUsed: true }).populate("bundleId");
  const bundles = codes.map(c => c.bundleId).filter(b => b);
  if (bundles.length > 0) return res.json(bundles);
  res.json([]);
});

app.post("/api/activate-code", async (req, res) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Unauthorized" });
  const decoded = jwt.verify(token, JWT_SECRET);
  const { code } = req.body;
  const accessCode = await AccessCode.findOne({ code, isActive: true });
  if (!accessCode) return res.status(400).json({ error: "کد نامعتبر!" });
  if (accessCode.userId.toString() !== decoded.id) return res.status(403).json({ error: "این کد مال شما نیست!" });
  if (accessCode.isUsed) return res.status(400).json({ error: "کد قبلاً استفاده شده!" });
  if (accessCode.expiresAt && new Date(accessCode.expiresAt) < new Date()) return res.status(400).json({ error: "کد منقضی شده!" });
  accessCode.isUsed = true;
  accessCode.usedAt = new Date();
  await accessCode.save();
  res.json({ message: "✅ کد فعال شد!", bundleId: accessCode.bundleId });
});

// ==================== USERS ADMIN ====================
app.get("/api/users", authMiddleware, async (req, res) => {
  const users = await User.find().sort({ createdAt: -1 });
  res.json(users);
});
app.put("/api/users/:id/toggle", authMiddleware, async (req, res) => {
  const user = await User.findById(req.params.id);
  if (user) { user.isActive = !user.isActive; await user.save(); }
  res.json(user);
});
app.delete("/api/users/:id", authMiddleware, async (req, res) => {
  await User.findByIdAndDelete(req.params.id);
  res.json({ message: "Deleted" });
});

// ==================== ACCESS CODES ====================
app.get("/api/access-codes", authMiddleware, async (req, res) => {
  const codes = await AccessCode.find().populate("bundleId").populate("userId").sort({ createdAt: -1 });
  res.json(codes);
});
app.post("/api/access-codes", authMiddleware, async (req, res) => {
  const { bundleId, userId, expiresAt } = req.body;
  const existing = await AccessCode.findOne({ bundleId, userId, isActive: true });
  if (existing) return res.status(400).json({ error: "Already exists!" });
  const code = "VIP-" + Math.random().toString(36).substring(2, 10).toUpperCase();
  const accessCode = await AccessCode.create({ bundleId, userId, code, expiresAt: expiresAt || null });
  res.json(accessCode);
});
app.put("/api/access-codes/:id/toggle", authMiddleware, async (req, res) => {
  const code = await AccessCode.findById(req.params.id);
  if (code) { code.isActive = !code.isActive; await code.save(); }
  res.json(code);
});
app.delete("/api/access-codes/:id", authMiddleware, async (req, res) => {
  await AccessCode.findByIdAndDelete(req.params.id);
  res.json({ message: "Deleted" });
});

app.get("/sw.js", (req, res) => res.sendFile(path.join(__dirname, "public", "sw.js")));

app.get("/", (req, res) => res.send("سرور من روشنه! MongoDB هم وصله!"));

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log("Server running on port " + PORT));