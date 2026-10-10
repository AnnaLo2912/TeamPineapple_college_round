
const express = require("express");
const cors = require("cors");
require("dotenv").config();

const app = express();

const sttRoute = require("./routes/sttRoute");
const ttsRoute = require("./routes/ttsRoute");

app.use(cors());
app.use(express.json());

app.get("/api/health", (req, res) => {
    res.json({ status: "ok", service: "Handsfree API" });
});

app.use("/api", sttRoute);
app.use("/api", ttsRoute);

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
