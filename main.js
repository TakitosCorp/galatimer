const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");
const fs = require("fs");
const bodyParser = require("body-parser");
const https = require("https");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;
const STATE_FILE = path.join(__dirname, "data", "timer-state.json");
const CODE_FILE = path.join(__dirname, "data", "code.json");

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

app.use(express.static(path.join(__dirname, "assets")));
app.use(bodyParser.urlencoded({ extended: false }));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "views", "index.html"));
});

app.get("/controller", (req, res) => {
  res.sendFile(path.join(__dirname, "views", "controller.html"));
});

let verificationToken = null;
try {
  const codeData = JSON.parse(fs.readFileSync(CODE_FILE));
  verificationToken = codeData.verification_token;
} catch (e) {
  verificationToken = null;
}

function getEurEquivalent(amount, currency, cb) {
  if (currency.toLowerCase() === "eur") {
    cb(amount);
    return;
  }
  const url = "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/eur.json";
  https
    .get(url, (resp) => {
      let data = "";
      resp.on("data", (chunk) => {
        data += chunk;
      });
      resp.on("end", () => {
        try {
          const json = JSON.parse(data);
          const rates = json.eur;
          const rate = rates[currency.toLowerCase()];
          if (!rate) {
            console.log(`[KOFI] Moneda no soportada: ${currency}`);
            cb(null);
            return;
          }
          const eurAmount = amount / rate;
          cb(eurAmount);
        } catch (e) {
          console.log("[KOFI] Error parseando la API de divisas:", e);
          cb(null);
        }
      });
    })
    .on("error", (err) => {
      console.log("[KOFI] Error solicitando la API de divisas:", err);
      cb(null);
    });
}

function handleKofiDonation(eurAmount, originalAmount, currency, payload) {
  if (!eurAmount || eurAmount < 2) {
    console.log(`[KOFI] Donación ignorada tras conversión: ${eurAmount} EUR`);
    return;
  }
  const minutes = (eurAmount / 2) * 5;
  const addSeconds = Math.floor(minutes * 60);
  if (addSeconds > 0) {
    timerState.remainingSeconds += addSeconds;
    timerState.isPaused = false;
    fs.writeFileSync(STATE_FILE, JSON.stringify(timerState));
    io.emit("add-time", {
      hours: 0,
      minutes: Math.floor(addSeconds / 60),
      seconds: addSeconds % 60,
      platform: "Ko-fi",
    });
    io.emit("timer-state", timerState);
    if (currency === "eur") {
      console.log(
        `[KOFI] Donación válida: +${Math.floor(addSeconds / 60)}m ${
          addSeconds % 60
        }s (${originalAmount} EUR) añadidos por ${payload.from_name || "desconocido"}.`
      );
    } else {
      console.log(
        `[KOFI] Donación válida: +${Math.floor(addSeconds / 60)}m ${
          addSeconds % 60
        }s (${originalAmount} ${currency.toUpperCase()} ≈ ${eurAmount.toFixed(2)} EUR) añadidos por ${
          payload.from_name || "desconocido"
        }.`
      );
    }
  }
}

app.post("/kofi-webhook", (req, res) => {
  try {
    if (timerState.remainingSeconds === 0) {
      console.log("[KOFI] Donación recibida pero ignorada porque el timer está en 0.");
      return res.sendStatus(200);
    }
    const payload = JSON.parse(req.body.data);
    console.log("[KOFI] Payload recibido:", payload);
    if (
      !payload ||
      payload.verification_token !== verificationToken ||
      !payload.type ||
      payload.type !== "Donation" ||
      !payload.is_public
    ) {
      console.log("[KOFI] Webhook ignorado por verificación/token/tipo/is_public.");
      return res.sendStatus(200);
    }
    const amount = parseFloat(payload.amount);
    const currency = (payload.currency || "EUR").toLowerCase();
    if (isNaN(amount) || amount < 2) {
      console.log(`[KOFI] Donación ignorada por cantidad insuficiente: ${payload.amount}`);
      return res.sendStatus(200);
    }

    getEurEquivalent(amount, currency, (eurAmount) => {
      handleKofiDonation(eurAmount, amount, currency, payload);
      res.sendStatus(200);
    });
  } catch (e) {
    console.log("[KOFI] Error procesando webhook:", e);
    res.sendStatus(200);
  }
});

io.on("connection", (socket) => {
  const clientType = socket.handshake.query.type;
  const clientId = socket.handshake.query.clientId;

  console.log(`[SOCKET] Cliente conectado - ID: ${clientId} (${clientType})`);

  if (clientType === "timer") {
    socket.emit("init-state", timerState);
  }

  socket.on("timer-update", (state) => {
    if (timerState.remainingSeconds === 0 && state.remainingSeconds > 0) {
      return;
    }
    timerState = state;
    socket.broadcast.emit("timer-state", state);
    fs.writeFileSync(STATE_FILE, JSON.stringify(state));
  });

  socket.on("timer-control", (command) => {
    socket.broadcast.emit("timer-command", command);
    if (command.action === "reset") {
      timerState.remainingSeconds = 4 * 60 * 60;
      fs.writeFileSync(STATE_FILE, JSON.stringify(timerState));
    }
  });

  socket.on("add-time", (data) => {
    socket.broadcast.emit("add-time", data);
  });

  socket.on("set-timer", (data) => {
    timerState.remainingSeconds = (data.hours || 0) * 3600 + (data.minutes || 0) * 60 + (data.seconds || 0);
    timerState.isPaused = false;
    timerState.lastPauseTime = null;
    fs.writeFileSync(STATE_FILE, JSON.stringify(timerState));
    io.emit("set-timer", data);
    io.emit("timer-state", timerState);
  });

  socket.on("disconnect", () => {
    console.log(`[SOCKET] Cliente desconectado - ID: ${clientId} (${clientType})`);
  });
});

server.listen(PORT, () => {
  console.log(`[SERVER] Servidor ejecutándose en http://localhost:${PORT}`);
  console.log(`[SERVER] Controlador disponible en http://localhost:${PORT}/controller`);
});

process.on("SIGINT", () => {
  fs.writeFileSync(STATE_FILE, JSON.stringify(timerState));
  process.exit();
});
