const express = require("express");
const mongoose = require("mongoose");
const app = express();

app.use(express.json());

// اتصال به MongoDB
const MONGO_URL = "mongodb+srv://dabcholi6_db_user:cvueDzp1DzUB6bCb@my-server-db.z2uaxrx.mongodb.net/my-server-db?retryWrites=true&w=majority";

mongoose.connect(MONGO_URL)
  .then(() => console.log("MongoDB connected!"))
  .catch(err => console.log("MongoDB error:", err));

app.get("/", (req, res) => {
  res.send("سرور من روشنه! MongoDB هم وصله!");
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});