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
app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});