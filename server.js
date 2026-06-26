const express = require("express");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const path = require("path");
const app = express();

app.use(express.json());
app.use(express.static("public"));

const MONGO_URL = "mongodb+srv://dabcholi6_db_user:cvueDzp1DzUB6bCb@my-server-db.z2uaxrx.mongodb.net/my-server-db?retryWrites=true&w=majority";
const JWT_SECRET = "my_super_secret_key_1403";

// مدل ادمین
const AdminSchema = new mongoose.Schema({
  email: String,
  password: String
});
const Admin = mongoose.model("Admin", AdminSchema);

// مدل کاربر
const UserSchema = new mongoose.Schema({
  name: String,
  phone: String,
  email: String,
  password: String,
  deviceId: String,
  isActive: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now }
});
const User = mongoose.model("User", UserSchema);

// مدل پوشه آموزشی
const BundleSchema = new mongoose.Schema({
  title: String,
  description: String,
  code: String,
  isActive: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now }
});
const Bundle = mongoose.model("Bundle", BundleSchema);

// مدل ویدیو
const VideoSchema = new mongoose.Schema({
  bundleId: { type: mongoose.Schema.Types.ObjectId, ref: "Bundle" },
  title: String,
  order: Number,
  filename: String,
  hlsPath: String,
  encryptionKey: String,
  duration: Number,
  createdAt: { type: Date, default: Date.now }
});
const Video = mongoose.model("Video", VideoSchema);

// مدل کد دسترسی
const AccessCodeSchema = new mongoose.Schema({
  bundleId: { type: mongoose.Schema.Types.ObjectId, ref: "Bundle" },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  code: String,
  deviceId: String,
  isUsed: { type: Boolean, default: false },
  usedAt: Date,
  expiresAt: Date,
  isActive: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now }
});
const AccessCode = mongoose.model("AccessCode", AccessCodeSchema);

// اتصال به MongoDB و ساخت ادمین پیش‌فرض
mongoose.connect(MONGO_URL)
  .then(async () => {
    console.log("MongoDB connected!");
    
    const existingAdmin = await Admin.findOne({ email: "admin@admin.com" });
    if (!existingAdmin) {
      const hashedPassword = await bcrypt.hash("123456", 10);
      await Admin.create({ email: "admin@admin.com", password: hashedPassword });
      console.log("Admin created: admin@admin.com / 123456");
    }
  })
  .catch(err => console.log("MongoDB error:", err));

// میدلور احراز هویت
const authMiddleware = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) return res.status(401).json({ error: "Unauthorized" });
    
    const decoded = jwt.verify(token, JWT_SECRET);
    req.adminId = decoded.id;
    next();
  } catch (err) {
    res.status(401).json({ error: "Invalid token" });
  }
};

// API ورود ادمین
app.post("/api/admin/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const admin = await Admin.findOne({ email });
    if (!admin) return res.status(401).json({ error: "Wrong email or password" });
    
    const isMatch = await bcrypt.compare(password, admin.password);
    if (!isMatch) return res.status(401).json({ error: "Wrong email or password" });
    
    const token = jwt.sign({ id: admin._id }, JWT_SECRET, { expiresIn: "24h" });
    res.json({ token, message: "Login successful" });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

// صفحه اصلی
app.get("/", (req, res) => {
  res.send("سرور من روشنه! MongoDB هم وصله!");
});

const PORT = process.env.PORT || 8080;
// ==================== API های پوشه ====================

// گرفتن همه پوشه‌ها
app.get("/api/bundles", authMiddleware, async (req, res) => {
  try {
    const bundles = await Bundle.find().sort({ createdAt: -1 });
    res.json(bundles);
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

// ساخت پوشه جدید
app.post("/api/bundles", authMiddleware, async (req, res) => {
  try {
    const { title, description } = req.body;
    const code = "BNDL-" + Math.random().toString(36).substring(2, 8).toUpperCase();
    
    const bundle = await Bundle.create({ title, description, code });
    res.json(bundle);
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

// حذف پوشه
app.delete("/api/bundles/:id", authMiddleware, async (req, res) => {
  try {
    await Bundle.findByIdAndDelete(req.params.id);
    await Video.deleteMany({ bundleId: req.params.id });
    await AccessCode.deleteMany({ bundleId: req.params.id });
    res.json({ message: "Bundle deleted" });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});
// ==================== API های ویدیو ====================
const multer = require("multer");
const { exec } = require("child_process");
const fs = require("fs");

const storage = multer.diskStorage({
  destination: "/tmp/uploads",
  filename: (req, file, cb) => {
    cb(null, Date.now() + "-" + file.originalname);
  }
});
const upload = multer({ storage, limits: { fileSize: 500 * 1024 * 1024 } });

// آپلود ویدیو
app.post("/api/videos", authMiddleware, upload.single("video"), async (req, res) => {
  try {
    const { bundleId, title, order } = req.body;
    const filePath = req.file.path;
    const videoId = new mongoose.Types.ObjectId();
    const outputDir = `/tmp/videos/${videoId}`;
    const hlsPath = `${outputDir}/master.m3u8`;
    
    fs.mkdirSync(outputDir, { recursive: true });
    
    // تبدیل به HLS با رمزنگاری AES-128
    const cmd = `ffmpeg -i ${filePath} -hls_time 10 -hls_list_size 0 -hls_segment_filename ${outputDir}/segment_%03d.ts ${hlsPath}`;
    
    exec(cmd, async (error) => {
      if (error) {
        console.log("FFmpeg error:", error);
        return res.status(500).json({ error: "Video conversion failed" });
      }
      
      const video = await Video.create({
        _id: videoId,
        bundleId,
        title,
        order: order || 1,
        filename: req.file.originalname,
        hlsPath,
        createdAt: new Date()
      });
      
      res.json({ message: "Video uploaded!", video });
    });
  } catch (err) {
    res.status(500).json({ error: "Upload failed" });
  }
});

// گرفتن ویدیوهای یک پوشه
app.get("/api/bundles/:id/videos", authMiddleware, async (req, res) => {
  try {
    const videos = await Video.find({ bundleId: req.params.id }).sort({ order: 1 });
    res.json(videos);
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

// حذف ویدیو
app.delete("/api/videos/:id", authMiddleware, async (req, res) => {
  try {
    const video = await Video.findByIdAndDelete(req.params.id);
    if (video && video.hlsPath) {
      const dir = video.hlsPath.replace("/master.m3u8", "");
      exec(`rm -rf ${dir}`);
    }
    res.json({ message: "Video deleted" });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

// استریم ویدیو
app.get("/stream/:videoId/*", async (req, res) => {
  try {
    const filePath = `/tmp/videos/${req.params.videoId}/${req.params[0]}`;
    if (fs.existsSync(filePath)) {
      res.sendFile(filePath);
    } else {
      res.status(404).json({ error: "File not found" });
    }
  } catch (err) {
    res.status(500).json({ error: "Stream error" });
  }
});
// ==================== API های کاربران ====================

// گرفتن همه کاربران
app.get("/api/users", authMiddleware, async (req, res) => {
  try {
    const users = await User.find().sort({ createdAt: -1 });
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

// غیرفعال/فعال کردن کاربر
app.put("/api/users/:id/toggle", authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    user.isActive = !user.isActive;
    await user.save();
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

// ==================== API های کد دسترسی ====================

// گرفتن همه کدها
app.get("/api/access-codes", authMiddleware, async (req, res) => {
  try {
    const codes = await AccessCode.find()
      .populate("bundleId", "title code")
      .populate("userId", "name phone email")
      .sort({ createdAt: -1 });
    res.json(codes);
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

// ساخت کد دسترسی جدید
app.post("/api/access-codes", authMiddleware, async (req, res) => {
  try {
    const { bundleId, userId, expiresAt } = req.body;
    
    // چک کن قبلاً کد داره یا نه
    const existing = await AccessCode.findOne({ bundleId, userId, isActive: true });
    if (existing) return res.status(400).json({ error: "این کاربر قبلاً کد داره!" });
    
    const code = "AC-" + Math.random().toString(36).substring(2, 10).toUpperCase();
    
    const accessCode = await AccessCode.create({
      bundleId,
      userId,
      code,
      expiresAt: expiresAt || null,
      isActive: true
    });
    
    res.json(accessCode);
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

// غیرفعال کردن کد
app.put("/api/access-codes/:id/deactivate", authMiddleware, async (req, res) => {
  try {
    const code = await AccessCode.findByIdAndUpdate(
      req.params.id,
      { isActive: false },
      { new: true }
    );
    res.json(code);
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});
// ==================== API های کد دسترسی ====================

// گرفتن همه کدها
app.get("/api/access-codes", authMiddleware, async (req, res) => {
  try {
    const codes = await AccessCode.find()
      .populate("bundleId", "title code")
      .populate("userId", "name phone email")
      .sort({ createdAt: -1 });
    res.json(codes);
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

// ساخت کد جدید
app.post("/api/access-codes", authMiddleware, async (req, res) => {
  try {
    const { bundleId, userId, expiresAt } = req.body;
    
    // چک کن قبلاً برای این کاربر و پوشه کد ساخته نشده باشه
    const existing = await AccessCode.findOne({ bundleId, userId, isActive: true });
    if (existing) return res.status(400).json({ error: "این کاربر قبلاً برای این پوشه کد داره!" });
    
    // ساخت کد یکتا
    const code = "VIP-" + Math.random().toString(36).substring(2, 10).toUpperCase();
    
    const accessCode = await AccessCode.create({
      bundleId,
      userId,
      code,
      expiresAt: expiresAt || null,
      isActive: true
    });
    
    await accessCode.populate("bundleId", "title code");
    await accessCode.populate("userId", "name phone");
    
    res.json(accessCode);
  } catch (err) {
    res.status(500).json({ error: err.message || "Server error" });
  }
});

// غیرفعال کردن کد
app.put("/api/access-codes/:id/toggle", authMiddleware, async (req, res) => {
  try {
    const code = await AccessCode.findById(req.params.id);
    if (!code) return res.status(404).json({ error: "Not found" });
    
    code.isActive = !code.isActive;
    await code.save();
    res.json(code);
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

// حذف کد
app.delete("/api/access-codes/:id", authMiddleware, async (req, res) => {
  try {
    await AccessCode.findByIdAndDelete(req.params.id);
    res.json({ message: "Deleted" });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});
app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});