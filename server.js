
const http = require("node:http");
const crypto = require("node:crypto");

const rooms = new Map();
const PORT = process.env.PORT || 3000;

function send(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  });
  res.end(JSON.stringify(data));
}

function code() {
  return crypto.randomBytes(3).toString("hex").toUpperCase();
}

function players(room) {
  return [...room.players.values()].map(p => ({
    id: p.id,
    name: p.name,
    hero: p.hero,
    input: p.input
  }));
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    return send(res, 200, {});
  }

  if (req.method === "GET" && req.url === "/") {
    return send(res, 200, {
      status: "online",
      game: "Escuadron Acajutla",
      maxPlayers: 4
    });
  }

  if (req.method !== "POST" || !req.url.startsWith("/api/")) {
    return send(res, 404, { error: "Ruta no encontrada" });
  }

  let body = "";

  for await (const chunk of req) {
    body += chunk;
    if (body.length > 500000) {
      return send(res, 413, { error: "Datos demasiado grandes" });
    }
  }

  let data;
  try {
    data = JSON.parse(body);
  } catch {
    return send(res, 400, { error: "JSON inválido" });
  }

  const action = req.url.slice(5);
  let room;

  if (action === "create") {
    let roomCode = code();
    while (rooms.has(roomCode)) roomCode = code();

    const id = crypto.randomUUID();
    const token = crypto.randomUUID();

    room = {
      code: roomCode,
      host: id,
      players: new Map(),
      world: null,
      phase: "lobby",
      updated: Date.now()
    };

    room.players.set(id, {
      id,
      token,
      name: String(data.name || "Jugador").slice(0, 18),
      hero: Number(data.hero) || 0,
      input: {},
      lastSeen: Date.now()
    });

    rooms.set(roomCode, room);

    return send(res, 200, {
      code: roomCode,
      id,
      token,
      host: true,
      slot: 0,
      players: players(room)
    });
  }

  room = rooms.get(String(data.code || "").toUpperCase());

  if (!room) {
    return send(res, 404, { error: "Sala no encontrada" });
  }

  if (action === "join") {
    if (room.players.size >= 4) {
      return send(res, 409, { error: "La sala está llena" });
    }

    const id = crypto.randomUUID();
    const token = crypto.randomUUID();

    const slot = room.players.size;

    room.players.set(id, {
      id,
      token,
      name: String(data.name || "Jugador").slice(0, 18),
      hero: Number(data.hero) || 0,
      input: {},
      lastSeen: Date.now()
    });

    return send(res, 200, {
      code: room.code,
      id,
      token,
      host: false,
      slot,
      players: players(room)
    });
  }

  const player = room.players.get(data.id);

  if (!player || player.token !== data.token) {
    return send(res, 403, { error: "Acceso no autorizado" });
  }

  player.lastSeen = Date.now();
  room.updated = Date.now();

  if (action === "leave") {
    room.players.delete(data.id);

    if (data.id === room.host || room.players.size === 0) {
      rooms.delete(room.code);
    }

    return send(res, 200, { ok: true });
  }

  if (action === "sync") {
    player.input = {
      ...(data.input || {}),
      slot: data.slot || 0,
      switchSeq: data.switchSeq || 0
    };

    if (data.id === room.host) {
      if (data.world) room.world = data.world;
      if (data.phase) room.phase = data.phase;
    }

    return send(res, 200, {
      players: players(room),
      host: room.host,
      world: data.id === room.host ? null : room.world,
      phase: room.phase
    });
  }

  return send(res, 404, { error: "Acción desconocida" });
});

setInterval(() => {
  const now = Date.now();

  for (const [code, room] of rooms) {
    for (const [id, player] of room.players) {
      if (now - player.lastSeen > 30000) {
        room.players.delete(id);
      }
    }

    if (!room.players.has(room.host) || room.players.size === 0) {
      rooms.delete(code);
    }
  }
}, 10000);

server.listen(PORT, "0.0.0.0", () => {
  console.log("Escuadron Acajutla servidor activo:", PORT);
});
