const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");
const fs = require("fs");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;
const STATE_FILE = path.join(__dirname, "data", "timer-state.json");

if (!fs.existsSync(path.join(__dirname, "data"))) {
  fs.mkdirSync(path.join(__dirname, "data"));
}

let timerState = {
  remainingSeconds: 4 * 60 * 60, // 4 horas
  isPaused: false,
  lastPauseTime: null,
};

try {
  const savedState = JSON.parse(fs.readFileSync(STATE_FILE));
  if (savedState.remainingSeconds) {
    timerState = savedState;
  }
} catch (error) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(timerState));
}

let lastTick = Date.now();
let lastSave = Date.now();

app.use(express.static(path.join(__dirname, "assets")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "views", "index.html"));
});

app.get("/controller", (req, res) => {
  res.sendFile(path.join(__dirname, "views", "controller.html"));
});

io.on("connection", (socket) => {
  const clientId = socket.handshake.query.clientId;
  const clientType = socket.handshake.query.type;

  console.log(`Cliente conectado - ID: ${clientId} (${clientType})`);

  if (clientType === "timer") {
    socket.emit("init-state", timerState);
  }

  socket.on("timer-update", (state) => {
    timerState = state;
    socket.broadcast.emit("timer-state", state);
    fs.writeFileSync(STATE_FILE, JSON.stringify(state));
  });

  socket.on("timer-control", (command) => {
    socket.broadcast.emit("timer-command", command);
    if (command.action === "reset") {
      timerState.remainingSeconds = 4 * 60 * 60; // Reset a 4 horas
      fs.writeFileSync(STATE_FILE, JSON.stringify(timerState));
    }
  });

  socket.on("add-time", (data) => {
    socket.broadcast.emit("add-time", data);
  });

  socket.on("disconnect", () => {
    console.log(`Cliente desconectado - ID: ${clientId} (${clientType})`);
  });
});

server.listen(PORT, () => {
  console.log(`Servidor ejecutándose en http://localhost:${PORT}`);
  console.log(`Controlador disponible en http://localhost:${PORT}/controller`);
});

process.on("SIGINT", () => {
  fs.writeFileSync(STATE_FILE, JSON.stringify(timerState));
  process.exit();
});
