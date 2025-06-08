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
  remainingSeconds: 4 * 60 * 60,
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

const timer = setInterval(() => {
  if (!timerState.isPaused && timerState.remainingSeconds > 0) {
    const now = Date.now();
    const delta = now - lastTick;

    if (delta >= 1000) {
      timerState.remainingSeconds--;
      lastTick = now;
      io.emit("timer-state", timerState);

      if (now - lastSave >= 2000) {
        fs.writeFileSync(STATE_FILE, JSON.stringify(timerState));
        lastSave = now;
      }
    }
  }
}, 100);

const broadcastInterval = setInterval(() => {
  io.emit("timer-sync", {
    remainingSeconds: timerState.remainingSeconds,
    isPaused: timerState.isPaused,
    lastPauseTime: timerState.lastPauseTime,
  });
}, 4000);

app.use(express.static(path.join(__dirname, "assets")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "views", "index.html"));
});

app.get("/controller", (req, res) => {
  res.sendFile(path.join(__dirname, "views", "controller.html"));
});

io.on("connection", (socket) => {
  socket.emit("timer-state", timerState);

  socket.on("request-sync", () => {
    socket.emit("timer-sync", {
      remainingSeconds: timerState.remainingSeconds,
      isPaused: timerState.isPaused,
      hours: Math.floor(timerState.remainingSeconds / 3600),
      minutes: Math.floor((timerState.remainingSeconds % 3600) / 60),
      seconds: timerState.remainingSeconds % 60,
    });
  });

  socket.on("set-timer", (timerData) => {
    if (timerData.source === "donation") {
      const currentSeconds = timerState.remainingSeconds;
      const additionalSeconds = timerData.hours * 3600 + timerData.minutes * 60 + timerData.seconds;
      timerState.remainingSeconds = currentSeconds + additionalSeconds;
    } else {
      const totalSeconds = timerData.hours * 3600 + timerData.minutes * 60 + timerData.seconds;
      timerState.remainingSeconds = totalSeconds;
    }
    timerState.isPaused = false;
    lastTick = Date.now();

    io.emit("timer-state", timerState);

    lastSave = Date.now();
    fs.writeFileSync(STATE_FILE, JSON.stringify(timerState));
  });

  socket.on("timer-control", (command) => {
    if (command.action === "pause") {
      timerState.isPaused = true;
      timerState.lastPauseTime = Date.now();
    } else if (command.action === "start") {
      if (timerState.lastPauseTime) {
        const pauseDuration = Date.now() - timerState.lastPauseTime;
        lastTick += pauseDuration;
      }
      timerState.isPaused = false;
      timerState.lastPauseTime = null;
    } else if (command.action === "reset") {
      timerState.remainingSeconds = 4 * 60 * 60;
      timerState.isPaused = false;
      timerState.lastPauseTime = null;
      lastTick = Date.now();
    }
    io.emit("timer-state", timerState);
    lastSave = Date.now();
    fs.writeFileSync(STATE_FILE, JSON.stringify(timerState));
  });
});

server.listen(PORT, () => {
  console.log(`Servidor ejecutándose en http://localhost:${PORT}`);
  console.log(`Controlador disponible en http://localhost:${PORT}/controller`);
});

process.on("SIGINT", () => {
  clearInterval(timer);
  clearInterval(broadcastInterval);
  fs.writeFileSync(STATE_FILE, JSON.stringify(timerState));
  process.exit();
});
