const express = require("express");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

// Test route
app.get("/", (req, res) => {
    res.json({
        success: true,
        server: "vibecash-food-server",
        status: "online"
    });
});

// Health check
app.get("/health", (req, res) => {
    res.json({
        success: true,
        status: "ok"
    });
});

// IMPORTANT:
// Render ke PORT par 0.0.0.0 se listen karna hai.
app.listen(PORT, "0.0.0.0", () => {
    console.log("=================================");
    console.log("VibeCash Food Server ONLINE");
    console.log("PORT:", PORT);
    console.log("=================================");
});
