import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { createServer as createViteServer } from "vite";
import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";
import NodeCache from "node-cache";
import nodemailer from "nodemailer";
import twilio from "twilio";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const db = new Database("database.db");

// Performance: In-memory cache for profiles and chats
const cache = new NodeCache({ stdTTL: 300, checkperiod: 60 });

// Performance: Simple background task queue
class TaskQueue {
  private queue: (() => Promise<void>)[] = [];
  private processing = false;

  add(task: () => Promise<void>) {
    this.queue.push(task);
    this.process();
  }

  private async process() {
    if (this.processing || this.queue.length === 0) return;
    this.processing = true;
    const task = this.queue.shift();
    if (task) {
      try {
        await task();
      } catch (e) {
        console.error("Task failed:", e);
      }
    }
    this.processing = false;
    this.process();
  }
}
const taskQueue = new TaskQueue();

// Initialize Database
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT, 
    email TEXT UNIQUE, 
    password TEXT, 
    nickname TEXT, 
    avatar TEXT,
    username TEXT UNIQUE,
    phone TEXT UNIQUE,
    phone_confirmed BOOLEAN DEFAULT 0,
    two_fa_enabled BOOLEAN DEFAULT 0,
    two_fa_secret TEXT,
    bio TEXT,
    last_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
    privacy_last_seen TEXT DEFAULT 'everyone',
    privacy_status TEXT DEFAULT 'everyone',
    notification_settings TEXT DEFAULT '{"sound":true,"global_mute":false}',
    public_key TEXT,
    is_blocked INTEGER DEFAULT 0,
    email_confirmed BOOLEAN DEFAULT 0,
    language TEXT DEFAULT 'ru',
    balance DECIMAL(10, 2) DEFAULT 0.00
  );
  
  CREATE TABLE IF NOT EXISTS stories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    media_url TEXT,
    media_type TEXT, -- 'image' or 'video'
    caption TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS polls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id INTEGER,
    sender_id INTEGER,
    question TEXT,
    is_anonymous BOOLEAN DEFAULT 1,
    multiple_choice BOOLEAN DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (chat_id) REFERENCES chats(id),
    FOREIGN KEY (sender_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS poll_options (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    poll_id INTEGER,
    option_text TEXT,
    FOREIGN KEY (poll_id) REFERENCES polls(id)
  );

  CREATE TABLE IF NOT EXISTS poll_votes (
    poll_id INTEGER,
    option_id INTEGER,
    user_id INTEGER,
    PRIMARY KEY (poll_id, option_id, user_id),
    FOREIGN KEY (poll_id) REFERENCES polls(id),
    FOREIGN KEY (option_id) REFERENCES poll_options(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sender_id INTEGER,
    receiver_id INTEGER,
    amount DECIMAL(10, 2),
    currency TEXT DEFAULT 'RUB',
    status TEXT DEFAULT 'completed', -- 'pending', 'completed', 'failed'
    message_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (sender_id) REFERENCES users(id),
    FOREIGN KEY (receiver_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS mini_apps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    description TEXT,
    icon_url TEXT,
    app_url TEXT,
    category TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  
  CREATE TABLE IF NOT EXISTS verification_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    identifier TEXT, -- email or phone
    code TEXT,
    expires_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Migration: Add missing columns if they don't exist
const tableInfo = db.prepare("PRAGMA table_info(users)").all() as any[];
const columns = tableInfo.map(c => c.name);

if (!columns.includes("public_key")) {
  db.exec("ALTER TABLE users ADD COLUMN public_key TEXT");
}
if (!columns.includes("is_blocked")) {
  db.exec("ALTER TABLE users ADD COLUMN is_blocked INTEGER DEFAULT 0");
}

db.exec(`
  CREATE TABLE IF NOT EXISTS blocks (
    blocker_id INTEGER,
    blocked_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (blocker_id, blocked_id),
    FOREIGN KEY (blocker_id) REFERENCES users(id),
    FOREIGN KEY (blocked_id) REFERENCES users(id)
  );
  
  CREATE TABLE IF NOT EXISTS chats (
    id INTEGER PRIMARY KEY AUTOINCREMENT, 
    type TEXT, 
    name TEXT, 
    avatar TEXT, 
    owner_id INTEGER,
    description TEXT,
    invite_code TEXT UNIQUE,
    pinned_message_id INTEGER
  );
  
  CREATE TABLE IF NOT EXISTS chat_members (
    chat_id INTEGER, 
    user_id INTEGER, 
    role TEXT DEFAULT 'member',
    is_muted BOOLEAN DEFAULT 0,
    notification_priority TEXT DEFAULT 'all',
    PRIMARY KEY(chat_id, user_id)
  );
  
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT, 
    chat_id INTEGER, 
    sender_id INTEGER, 
    text TEXT, 
    is_edited BOOLEAN DEFAULT 0, 
    reply_to_id INTEGER,
    forward_from_id INTEGER,
    reactions TEXT DEFAULT '{}',
    file_url TEXT,
    file_type TEXT,
    file_name TEXT,
    message_type TEXT DEFAULT 'text', -- 'text', 'file', 'poll', 'payment', 'story_reply'
    poll_id INTEGER,
    payment_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    url TEXT,
    type TEXT,
    size INTEGER,
    uploader_id INTEGER,
    chat_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS calls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id INTEGER,
    caller_id INTEGER,
    receiver_id INTEGER,
    type TEXT, -- 'voice' or 'video'
    status TEXT, -- 'ongoing', 'ended', 'missed'
    duration INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    type TEXT, -- 'message', 'call', 'system'
    title TEXT,
    body TEXT,
    is_read BOOLEAN DEFAULT 0,
    data TEXT, -- JSON extra data
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Migration from old names if they exist
try {
  const oldRooms = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='rooms'").get();
  if (oldRooms) {
    console.log("Migrating rooms to chats...");
    db.exec("INSERT INTO chats SELECT * FROM rooms");
    db.exec("DROP TABLE rooms");
  }
  const oldMembers = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='room_members'").get();
  if (oldMembers) {
    console.log("Migrating room_members to chat_members...");
    db.exec("INSERT INTO chat_members SELECT * FROM room_members");
    db.exec("DROP TABLE room_members");
  }
  // Update messages column name if needed
  const msgCols = db.prepare("PRAGMA table_info(messages)").all() as any[];
  if (msgCols.some(c => c.name === 'room_id')) {
    console.log("Renaming messages.room_id to chat_id...");
    db.exec("ALTER TABLE messages RENAME COLUMN room_id TO chat_id");
  }
} catch (e) {
  console.error("Migration error:", e);
}

// Add unique indexes separately
try {
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username)");
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_phone ON users(phone)");
} catch (e: any) {
  console.error("Error creating indexes:", e.message);
}

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: "*",
    },
  });

  app.use(express.json({ limit: "10mb" }));

  // Helper to send OTP
  let testAccount: any = null;
  const sendOTP = async (identifier: string, code: string) => {
    const isEmail = identifier.includes("@");
    if (isEmail) {
      const transporterOpts: any = {
        host: process.env.SMTP_HOST || "smtp.ethereal.email",
        port: Number(process.env.SMTP_PORT) || 587,
        secure: false,
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
      };

      // If no real credentials, use ethereal for demo
      if (!process.env.SMTP_HOST) {
        if (!testAccount) {
          testAccount = await nodemailer.createTestAccount();
        }
        transporterOpts.host = testAccount.smtp.host;
        transporterOpts.port = testAccount.smtp.port;
        transporterOpts.auth = { user: testAccount.user, pass: testAccount.pass };
      }

      const transporter = nodemailer.createTransport(transporterOpts);
      const info = await transporter.sendMail({
        from: '"NeMessenger" <no-reply@nemessenger.com>',
        to: identifier,
        subject: "Код подтверждения NeMessenger",
        text: `Ваш код подтверждения: ${code}`,
        html: `<b>Ваш код подтверждения: ${code}</b>`,
      });

      if (!process.env.SMTP_HOST) {
        console.log("OTP Email sent to Ethereal:", nodemailer.getTestMessageUrl(info));
        return { devCode: code, url: nodemailer.getTestMessageUrl(info) };
      }
    } else {
      // SMS via Twilio
      if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
        const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
        await client.messages.create({
          body: `Ваш код подтверждения NeMessenger: ${code}`,
          from: process.env.TWILIO_PHONE_NUMBER,
          to: identifier,
        });
      } else {
        console.log(`[MOCK SMS] To: ${identifier}, Code: ${code}`);
        return { devCode: code };
      }
    }
    return {};
  };

  app.post("/api/send_otp", async (req, res) => {
    const { identifier } = req.body;
    if (!identifier) return res.status(400).json({ success: false, message: "Identifier required" });

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 mins

    try {
      db.prepare("DELETE FROM verification_codes WHERE identifier = ?").run(identifier);
      db.prepare("INSERT INTO verification_codes (identifier, code, expires_at) VALUES (?, ?, ?)").run(identifier, code, expiresAt);
      
      const devInfo = await sendOTP(identifier, code);
      
      // In development/demo mode without keys, we return the code for convenience
      const response: any = { success: true, message: "Код отправлен" };
      if (devInfo && devInfo.devCode && !process.env.SMTP_HOST && !process.env.TWILIO_ACCOUNT_SID) {
        response.devCode = devInfo.devCode;
        response.devUrl = devInfo.url;
      }
      
      res.json(response);
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ success: false, message: "Ошибка при отправке кода" });
    }
  });

  app.post("/api/verify_otp", (req, res) => {
    const { identifier, code } = req.body;
    const record: any = db.prepare("SELECT * FROM verification_codes WHERE identifier = ? AND code = ?").get(identifier, code);
    
    if (record) {
      const now = new Date().toISOString();
      if (record.expires_at > now) {
        res.json({ success: true });
      } else {
        res.json({ success: false, message: "Код истек" });
      }
    } else {
      res.json({ success: false, message: "Неверный код" });
    }
  });

  // Performance: CDN simulation - Cache-Control headers for static assets
  app.use("/assets", express.static(path.join(__dirname, "public/assets"), {
    maxAge: "1d",
    immutable: true
  }));

  // Logging Middleware
  app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
  });

  // API Routes
  app.post("/api/register", (req, res) => {
    try {
      const { email, password, nickname, username, phone, avatar, code } = req.body;
      const identifier = email || phone;
      
      // Verify OTP again before registration
      const record: any = db.prepare("SELECT * FROM verification_codes WHERE identifier = ? AND code = ?").get(identifier, code);
      if (!record || record.expires_at < new Date().toISOString()) {
        return res.json({ success: false, message: "Код не подтвержден или истек" });
      }

      const stmt = db.prepare("INSERT INTO users (email, password, nickname, username, phone, avatar, email_confirmed, phone_confirmed) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
      stmt.run(email || null, password, nickname, username, phone || null, avatar, email ? 1 : 0, phone ? 1 : 0);
      
      const user = db.prepare("SELECT * FROM users WHERE username = ?").get(username);
      
      // Cleanup code
      db.prepare("DELETE FROM verification_codes WHERE identifier = ?").run(identifier);
      
      res.json({ success: true, user });
    } catch (err: any) {
      console.error(err);
      res.json({ success: false, message: "Email, Username or Phone already taken." });
    }
  });

  app.post("/api/login", (req, res) => {
    const { identifier, password } = req.body;
    const user: any = db.prepare("SELECT * FROM users WHERE (email = ? OR phone = ?) AND password = ?").get(identifier, identifier, password);
    if (user) {
      if (user.two_fa_enabled) {
        res.json({ success: true, requires2FA: true, userId: user.id });
      } else {
        res.json({ success: true, user });
      }
    } else {
      res.json({ success: false, message: "Неверные учетные данные!" });
    }
  });

  app.post("/api/verify_2fa", (req, res) => {
    const { userId, code } = req.body;
    const user: any = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
    // In a real app, verify 'code' against 'user.two_fa_secret' using a library like 'otplib'
    // For this demo, we'll accept '123456'
    if (code === "123456") {
      res.json({ success: true, user });
    } else {
      res.json({ success: false, message: "Invalid 2FA code" });
    }
  });

  app.post("/api/recover_password", (req, res) => {
    const { email } = req.body;
    const user = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
    if (user) {
      // Mock sending email
      res.json({ success: true, message: "Recovery instructions sent to your email." });
    } else {
      res.json({ success: false, message: "User not found." });
    }
  });

  app.post("/api/verify_phone", (req, res) => {
    const { userId, code } = req.body;
    if (code === "0000") {
      db.prepare("UPDATE users SET phone_confirmed = 1 WHERE id = ?").run(userId);
      res.json({ success: true });
    } else {
      res.json({ success: false, message: "Invalid verification code" });
    }
  });

  app.post("/api/update_profile", (req, res) => {
    const { id, nickname, username, bio, avatar, privacy_last_seen, privacy_status, two_fa_enabled, notification_settings } = req.body;
    try {
      db.prepare(`
        UPDATE users 
        SET nickname = ?, username = ?, bio = ?, avatar = ?, 
            privacy_last_seen = ?, privacy_status = ?, two_fa_enabled = ?,
            notification_settings = ?
        WHERE id = ?
      `).run(nickname, username, bio, avatar, privacy_last_seen, privacy_status, two_fa_enabled ? 1 : 0, notification_settings, id);
      const user = db.prepare("SELECT * FROM users WHERE id = ?").get(id);
      res.json({ success: true, user });
    } catch (err) {
      res.json({ success: false, message: "Username already taken." });
    }
  });

  app.get("/api/user_profile/:id", (req, res) => {
    const cacheKey = `profile_${req.params.id}`;
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    const user: any = db.prepare("SELECT id, nickname, username, bio, avatar, last_seen, privacy_last_seen, privacy_status, notification_settings FROM users WHERE id = ?").get(req.params.id);
    if (user) {
      cache.set(cacheKey, user);
      res.json(user);
    } else {
      res.status(404).json({ message: "User not found" });
    }
  });

  app.get("/api/my_chats", (req, res) => {
    const userId = req.query.userId;
    const cacheKey = `chats_${userId}`;
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    const query = db.prepare(`
      SELECT c.id as room_id, c.type, c.owner_id, c.description, c.invite_code, c.pinned_message_id, cm.role, cm.is_muted, cm.notification_priority,
             CASE WHEN c.type = 'private' THEN cm2.user_id ELSE NULL END as target_user_id,
             CASE WHEN c.type = 'private' THEN u.nickname ELSE c.name END as name,
             CASE WHEN c.type = 'private' THEN u.avatar ELSE c.avatar END as avatar
      FROM chat_members cm
      JOIN chats c ON cm.chat_id = c.id
      LEFT JOIN chat_members cm2 ON cm2.chat_id = c.id AND cm2.user_id != ?
      LEFT JOIN users u ON cm2.user_id = u.id
      WHERE cm.user_id = ?
    `);
    const results = query.all(userId, userId);
    cache.set(cacheKey, results);
    res.json(results);
  });

  app.get("/api/room_info", (req, res) => {
    const { roomId, userId } = req.query;
    const room: any = db.prepare("SELECT * FROM chats WHERE id = ?").get(roomId);
    if (!room) return res.status(404).json({ message: "Room not found" });
    
    const member: any = db.prepare("SELECT role, is_muted, notification_priority FROM chat_members WHERE chat_id = ? AND user_id = ?").get(roomId, userId);
    
    res.json({
      ...room,
      room_id: room.id,
      role: member?.role,
      is_muted: member?.is_muted,
      notification_priority: member?.notification_priority
    });
  });

  app.get("/api/room_members", (req, res) => {
    const { roomId } = req.query;
    const members = db.prepare(`
      SELECT u.id, u.nickname, u.avatar, u.username, cm.role
      FROM chat_members cm
      JOIN users u ON cm.user_id = u.id
      WHERE cm.chat_id = ?
    `).all(roomId);
    res.json(members);
  });

  app.get("/api/search", (req, res) => {
    const q = req.query.q;
    const userId = req.query.userId;
    if (!q) return res.json([]);
    
    const users = db.prepare(`SELECT id, nickname as name, avatar, 'user' as type FROM users WHERE nickname LIKE ? OR username LIKE ? LIMIT 10`).all(`%${q}%`, `%${q}%`);
    const rooms = db.prepare(`SELECT id, name, avatar, type, owner_id FROM chats WHERE type IN ('group', 'channel') AND name LIKE ? LIMIT 10`).all(`%${q}%`);
    
    // Search messages in chats user is member of
    const messages = db.prepare(`
      SELECT m.id, m.text, m.created_at, m.chat_id as room_id, u.nickname as sender_name, c.name as room_name, 'message' as type
      FROM messages m
      JOIN users u ON m.sender_id = u.id
      JOIN chats c ON m.chat_id = c.id
      JOIN chat_members cm ON m.chat_id = cm.chat_id
      WHERE cm.user_id = ? AND m.text LIKE ?
      LIMIT 20
    `).all(userId, `%${q}%`);

    res.json([...users, ...rooms, ...messages]);
  });

  app.post("/api/private_chat", (req, res) => {
    const { user1_id, user2_id } = req.body;
    const existingRoom: any = db.prepare(`
      SELECT cm1.chat_id as room_id FROM chat_members cm1 
      JOIN chat_members cm2 ON cm1.chat_id = cm2.chat_id 
      JOIN chats c ON cm1.chat_id = c.id
      WHERE c.type = 'private' AND cm1.user_id = ? AND cm2.user_id = ?
    `).get(user1_id, user2_id);

    if (existingRoom) {
      res.json({ room_id: existingRoom.room_id });
    } else {
      const info = db.prepare("INSERT INTO chats (type) VALUES ('private')").run();
      const roomId = info.lastInsertRowid;
      db.prepare("INSERT INTO chat_members (chat_id, user_id) VALUES (?, ?)").run(roomId, user1_id);
      db.prepare("INSERT INTO chat_members (chat_id, user_id) VALUES (?, ?)").run(roomId, user2_id);
      res.json({ room_id: roomId });
    }
  });

  app.post("/api/create_room", (req, res) => {
    const { name, type, avatar, owner_id, description } = req.body;
    const invite_code = Math.random().toString(36).substring(2, 10);
    const info = db.prepare("INSERT INTO chats (name, type, avatar, owner_id, description, invite_code) VALUES (?, ?, ?, ?, ?, ?)").run(name, type, avatar, owner_id, description || '', invite_code);
    const roomId = info.lastInsertRowid;
    db.prepare("INSERT INTO chat_members (chat_id, user_id, role) VALUES (?, ?, 'owner')").run(roomId, owner_id);
    res.json({ success: true, room_id: roomId, invite_code });
  });

  app.post("/api/join_by_invite", (req, res) => {
    const { user_id, invite_code } = req.body;
    const room: any = db.prepare("SELECT id FROM chats WHERE invite_code = ?").get(invite_code);
    if (!room) return res.status(404).json({ success: false, message: "Invalid invite code" });
    
    try {
      db.prepare("INSERT INTO chat_members (chat_id, user_id, role) VALUES (?, ?, 'member')").run(room.id, user_id);
    } catch (e) {}
    res.json({ success: true, room_id: room.id });
  });

  app.post("/api/pin_message", (req, res) => {
    const { room_id, message_id } = req.body;
    db.prepare("UPDATE chats SET pinned_message_id = ? WHERE id = ?").run(message_id, room_id);
    res.json({ success: true });
  });

  app.post("/api/manage_member", (req, res) => {
    const { room_id, user_id, role } = req.body;
    db.prepare("UPDATE chat_members SET role = ? WHERE chat_id = ? AND user_id = ?").run(role, room_id, user_id);
    res.json({ success: true });
  });

  app.post("/api/join_room", (req, res) => {
    const { user_id, room_id } = req.body;
    try {
      db.prepare("INSERT INTO chat_members (chat_id, user_id, role) VALUES (?, ?, 'member')").run(room_id, user_id);
    } catch (e) {}
    res.json({ success: true });
  });

  app.post("/api/update_room_settings", (req, res) => {
    const { room_id, user_id, is_muted, notification_priority } = req.body;
    db.prepare("UPDATE chat_members SET is_muted = ?, notification_priority = ? WHERE chat_id = ? AND user_id = ?")
      .run(is_muted ? 1 : 0, notification_priority, room_id, user_id);
    res.json({ success: true });
  });

  app.post("/api/update_global_settings", (req, res) => {
    const { user_id, notification_settings } = req.body;
    db.prepare("UPDATE users SET notification_settings = ? WHERE id = ?")
      .run(JSON.stringify(notification_settings), user_id);
    res.json({ success: true });
  });

  app.post("/api/update_public_key", (req, res) => {
    const { user_id, public_key } = req.body;
    db.prepare("UPDATE users SET public_key = ? WHERE id = ?").run(public_key, user_id);
    cache.del(`profile_${user_id}`);
    res.json({ success: true });
  });

  app.post("/api/leave_room", (req, res) => {
    const { room_id, user_id } = req.body;
    db.prepare("DELETE FROM chat_members WHERE chat_id = ? AND user_id = ?").run(room_id, user_id);
    cache.del(`chats_${user_id}`);
    res.json({ success: true });
  });

  app.post("/api/delete_room", (req, res) => {
    const { room_id, user_id } = req.body;
    const rid = Number(room_id);
    const uid = Number(user_id);
    
    console.log(`[DELETE_ROOM] Request for room ${rid} by user ${uid}`);
    
    const member: any = db.prepare("SELECT role FROM chat_members WHERE chat_id = ? AND user_id = ?").get(rid, uid);
    const room: any = db.prepare("SELECT owner_id, type FROM chats WHERE id = ?").get(rid);
    
    if (!room) {
      console.log(`[DELETE_ROOM] Room ${rid} not found`);
      return res.status(404).json({ success: false, message: "Room not found" });
    }

    const isOwner = (member && member.role === 'owner') || (room && room.owner_id === uid);
    const isAdmin = member && member.role === 'admin';
    const isPrivate = room.type === 'private' && member; // Any member of a private chat can delete it

    console.log(`[DELETE_ROOM] Permissions: isOwner=${isOwner}, isAdmin=${isAdmin}, isPrivate=${isPrivate}, role=${member?.role}`);

    if (isOwner || isAdmin || isPrivate) {
      // Get all members to clear their cache
      const members = db.prepare("SELECT user_id FROM chat_members WHERE chat_id = ?").all(rid);
      
      db.prepare("DELETE FROM messages WHERE chat_id = ?").run(rid);
      db.prepare("DELETE FROM chat_members WHERE chat_id = ?").run(rid);
      db.prepare("DELETE FROM files WHERE chat_id = ?").run(rid);
      db.prepare("DELETE FROM calls WHERE chat_id = ?").run(rid);
      db.prepare("DELETE FROM chats WHERE id = ?").run(rid);
      
      // Clear cache for all members
      members.forEach((m: any) => {
        cache.del(`chats_${m.user_id}`);
      });
      
      console.log(`[DELETE_ROOM] Room ${rid} deleted successfully`);
      io.to("room_" + rid).emit("room_deleted", { room_id: rid });
      res.json({ success: true });
    } else {
      console.log(`[DELETE_ROOM] Permission denied for user ${uid} in room ${rid}`);
      res.status(403).json({ success: false, message: "Permission denied. You must be an owner or admin." });
    }
  });

  app.post("/api/block_user", (req, res) => {
    const { blocker_id, blocked_id } = req.body;
    try {
      db.prepare("INSERT INTO blocks (blocker_id, blocked_id) VALUES (?, ?)").run(blocker_id, blocked_id);
      res.json({ success: true });
    } catch (e) {
      res.status(400).json({ message: "Already blocked or error" });
    }
  });

  app.post("/api/unblock_user", (req, res) => {
    const { blocker_id, blocked_id } = req.body;
    db.prepare("DELETE FROM blocks WHERE blocker_id = ? AND blocked_id = ?").run(blocker_id, blocked_id);
    res.json({ success: true });
  });

  app.get("/api/blocked_users", (req, res) => {
    const { userId } = req.query;
    const blocked = db.prepare(`
      SELECT u.id, u.nickname, u.username, u.avatar 
      FROM blocks b 
      JOIN users u ON b.blocked_id = u.id 
      WHERE b.blocker_id = ?
    `).all(userId);
    res.json(blocked);
  });

  app.get("/api/is_blocked", (req, res) => {
    const { blocker_id, blocked_id } = req.query;
    const block = db.prepare("SELECT 1 FROM blocks WHERE blocker_id = ? AND blocked_id = ?").get(blocker_id, blocked_id);
    res.json({ blocked: !!block });
  });

  app.get("/api/room_history", (req, res) => {
    const roomId = req.query.roomId;
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;

    const history = db.prepare(`
      SELECT m.*, u.nickname, u.avatar 
      FROM messages m 
      JOIN users u ON m.sender_id = u.id 
      WHERE m.chat_id = ? 
      ORDER BY m.id DESC
      LIMIT ? OFFSET ?
    `).all(roomId, limit, offset);
    
    // Return in chronological order for frontend
    res.json(history.reverse());
  });

  // Files API
  app.post("/api/upload_file", (req, res) => {
    const { name, url, type, size, uploader_id, chat_id } = req.body;
    const info = db.prepare("INSERT INTO files (name, url, type, size, uploader_id, chat_id) VALUES (?, ?, ?, ?, ?, ?)")
      .run(name, url, type, size, uploader_id, chat_id);
    res.json({ success: true, file_id: info.lastInsertRowid });
  });

  app.get("/api/chat_files", (req, res) => {
    const { chatId } = req.query;
    const files = db.prepare("SELECT * FROM files WHERE chat_id = ? ORDER BY created_at DESC").all(chatId);
    res.json(files);
  });

  // Calls API
  app.post("/api/create_call", (req, res) => {
    const { chat_id, caller_id, receiver_id, type } = req.body;
    const info = db.prepare("INSERT INTO calls (chat_id, caller_id, receiver_id, type, status) VALUES (?, ?, ?, ?, 'ongoing')")
      .run(chat_id, caller_id, receiver_id, type);
    res.json({ success: true, call_id: info.lastInsertRowid });
  });

  app.post("/api/end_call", (req, res) => {
    const { call_id, duration, status } = req.body;
    db.prepare("UPDATE calls SET status = ?, duration = ? WHERE id = ?").run(status, duration, call_id);
    res.json({ success: true });
  });

  // Notifications API
  app.get("/api/notifications", (req, res) => {
    const { userId } = req.query;
    const notifications = db.prepare("SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50").all(userId);
    res.json(notifications);
  });

  // Stories
  app.get("/api/stories", (req, res) => {
    const stories = db.prepare(`
      SELECT s.*, u.nickname, u.avatar, u.username 
      FROM stories s 
      JOIN users u ON s.user_id = u.id 
      WHERE s.expires_at > CURRENT_TIMESTAMP 
      ORDER BY s.created_at DESC
    `).all();
    res.json(stories);
  });

  app.post("/api/stories", (req, res) => {
    const { user_id, media_url, media_type, caption } = req.body;
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const info = db.prepare("INSERT INTO stories (user_id, media_url, media_type, caption, expires_at) VALUES (?, ?, ?, ?, ?)")
      .run(user_id, media_url, media_type, caption, expiresAt);
    res.json({ success: true, story_id: info.lastInsertRowid });
  });

  // Polls
  app.post("/api/polls", (req, res) => {
    const { chat_id, sender_id, question, options, is_anonymous, multiple_choice } = req.body;
    const info = db.prepare("INSERT INTO polls (chat_id, sender_id, question, is_anonymous, multiple_choice) VALUES (?, ?, ?, ?, ?)")
      .run(chat_id, sender_id, question, is_anonymous ? 1 : 0, multiple_choice ? 1 : 0);
    const pollId = info.lastInsertRowid;
    
    const stmt = db.prepare("INSERT INTO poll_options (poll_id, option_text) VALUES (?, ?)");
    options.forEach((opt: string) => stmt.run(pollId, opt));
    
    res.json({ success: true, poll_id: pollId });
  });

  app.get("/api/poll/:id", (req, res) => {
    const poll: any = db.prepare("SELECT * FROM polls WHERE id = ?").get(req.params.id);
    if (!poll) return res.status(404).json({ message: "Poll not found" });
    
    const options = db.prepare("SELECT * FROM poll_options WHERE poll_id = ?").all(req.params.id);
    const votes = db.prepare("SELECT * FROM poll_votes WHERE poll_id = ?").all(req.params.id);
    
    res.json({ ...poll, options, votes });
  });

  app.post("/api/poll/vote", (req, res) => {
    const { poll_id, option_id, user_id } = req.body;
    try {
      db.prepare("INSERT INTO poll_votes (poll_id, option_id, user_id) VALUES (?, ?, ?)").run(poll_id, option_id, user_id);
      res.json({ success: true });
    } catch (e) {
      res.status(400).json({ message: "Already voted or error" });
    }
  });

  // Payments
  app.post("/api/payments/send", (req, res) => {
    const { sender_id, receiver_id, amount, currency } = req.body;
    const sender: any = db.prepare("SELECT balance FROM users WHERE id = ?").get(sender_id);
    
    if (sender.balance < amount) {
      return res.status(400).json({ success: false, message: "Insufficient balance" });
    }
    
    db.transaction(() => {
      db.prepare("UPDATE users SET balance = balance - ? WHERE id = ?").run(amount, sender_id);
      db.prepare("UPDATE users SET balance = balance + ? WHERE id = ?").run(amount, receiver_id);
      db.prepare("INSERT INTO payments (sender_id, receiver_id, amount, currency) VALUES (?, ?, ?, ?)")
        .run(sender_id, receiver_id, amount, currency || 'RUB');
    })();
    
    res.json({ success: true });
  });

  // Mini Apps
  app.get("/api/mini_apps", (req, res) => {
    const apps = db.prepare("SELECT * FROM mini_apps ORDER BY created_at DESC").all();
    res.json(apps);
  });

  app.get("/api/payment/:id", (req, res) => {
    const payment = db.prepare('SELECT * FROM payments WHERE id = ?').get(req.params.id);
    res.json(payment);
  });

  app.post("/api/mark_notification_read", (req, res) => {
    const { notification_id } = req.body;
    db.prepare("UPDATE notifications SET is_read = 1 WHERE id = ?").run(notification_id);
    res.json({ success: true });
  });

  const onlineUsers = new Set();

  app.get("/api/online_users", (req, res) => {
    res.json(Array.from(onlineUsers));
  });

  // Socket.io logic
  io.on("connection", (socket: any) => {
    socket.on("user_connected", (userId: any) => {
      socket.userId = userId;
      onlineUsers.add(userId);
      db.prepare("UPDATE users SET last_seen = CURRENT_TIMESTAMP WHERE id = ?").run(userId);
      io.emit("user_status", { userId: userId, status: "online" });

      const rooms: any[] = db.prepare("SELECT chat_id FROM chat_members WHERE user_id = ?").all(userId);
      rooms.forEach((r) => socket.join("room_" + r.chat_id));
    });

    socket.on("typing", (data: any) => {
      socket.to("room_" + data.room_id).emit("typing", {
        room_id: data.room_id,
        nickname: data.nickname,
      });
    });

    socket.on("stop_typing", (data: any) => {
      socket.to("room_" + data.room_id).emit("stop_typing", { room_id: data.room_id });
    });

    socket.on("room_message", (data: any) => {
      const sender: any = db.prepare("SELECT nickname, avatar, is_blocked FROM users WHERE id = ?").get(data.sender_id);
      if (!sender || sender.is_blocked) return;

      // Check if sender is blocked by recipient in private chats
      const chat: any = db.prepare("SELECT type FROM chats WHERE id = ?").get(data.room_id);
      if (chat && chat.type === 'private') {
        const recipient: any = db.prepare("SELECT user_id FROM chat_members WHERE chat_id = ? AND user_id != ?").get(data.room_id, data.sender_id);
        if (recipient) {
          const isBlocked = db.prepare("SELECT 1 FROM blocks WHERE blocker_id = ? AND blocked_id = ?").get(recipient.user_id, data.sender_id);
          if (isBlocked) return; // Silent drop if blocked
        }
      }
      
      const info = db.prepare(`
        INSERT INTO messages (chat_id, sender_id, text, reply_to_id, forward_from_id, file_url, file_type, file_name, message_type, poll_id, payment_id) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        data.room_id, 
        data.sender_id, 
        data.text, 
        data.reply_to_id || null, 
        data.forward_from_id || null, 
        data.file_url || null, 
        data.file_type || null, 
        data.file_name || null,
        data.message_type || 'text',
        data.poll_id || null,
        data.payment_id || null
      );
      
      const message = {
        id: info.lastInsertRowid,
        room_id: data.room_id,
        sender_id: data.sender_id,
        nickname: sender.nickname,
        avatar: sender.avatar,
        text: data.text,
        is_edited: 0,
        reply_to_id: data.reply_to_id || null,
        forward_from_id: data.forward_from_id || null,
        file_url: data.file_url || null,
        file_type: data.file_type || null,
        file_name: data.file_name || null,
        message_type: data.message_type || 'text',
        poll_id: data.poll_id || null,
        payment_id: data.payment_id || null,
        reactions: '{}',
        created_at: new Date().toISOString(),
      };
      io.to("room_" + data.room_id).emit("room_message", message);

      // Performance: Process notifications in background
      taskQueue.add(async () => {
        const members = db.prepare("SELECT user_id FROM chat_members WHERE chat_id = ? AND user_id != ?").all(data.room_id, data.sender_id) as any[];
        members.forEach(m => {
          db.prepare("INSERT INTO notifications (user_id, type, title, body, data) VALUES (?, 'message', ?, ?, ?)")
            .run(m.user_id, sender.nickname, data.text.substring(0, 100), JSON.stringify({ chat_id: data.room_id }));
        });
      });
    });

    socket.on("react_message", (data: any) => {
      const msg: any = db.prepare("SELECT reactions FROM messages WHERE id = ?").get(data.msg_id);
      if (msg) {
        let reactions = {};
        try {
          reactions = JSON.parse(msg.reactions || '{}');
        } catch (e) {
          reactions = {};
        }
        const userReactions = (reactions as any)[data.emoji] || [];
        
        if (userReactions.includes(data.user_id)) {
          reactions[data.emoji] = userReactions.filter((id: number) => id !== data.user_id);
          if (reactions[data.emoji].length === 0) delete reactions[data.emoji];
        } else {
          reactions[data.emoji] = [...userReactions, data.user_id];
        }
        
        db.prepare("UPDATE messages SET reactions = ? WHERE id = ?").run(JSON.stringify(reactions), data.msg_id);
        io.to("room_" + data.room_id).emit("message_reacted", { msg_id: data.msg_id, reactions });
      }
    });

    socket.on("delete_message", (data: any) => {
      const result = db.prepare("DELETE FROM messages WHERE id = ? AND sender_id = ?").run(data.msg_id, data.sender_id);
      if (result.changes > 0) {
        io.to("room_" + data.room_id).emit("message_deleted", { msg_id: data.msg_id });
      }
    });

    socket.on("edit_message", (data: any) => {
      const result = db.prepare("UPDATE messages SET text = ?, is_edited = 1 WHERE id = ? AND sender_id = ?").run(data.new_text, data.msg_id, data.sender_id);
      if (result.changes > 0) {
        io.to("room_" + data.room_id).emit("message_edited", { msg_id: data.msg_id, new_text: data.new_text });
      }
    });

    socket.on("join_socket_room", (roomId: any) => socket.join("room_" + roomId));

    socket.on("disconnect", () => {
      if (socket.userId) {
        onlineUsers.delete(socket.userId);
        db.prepare("UPDATE users SET last_seen = CURRENT_TIMESTAMP WHERE id = ?").run(socket.userId);
        io.emit("user_status", { userId: socket.userId, status: "offline", last_seen: new Date().toISOString() });
      }
    });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  }

  const PORT = 3000;
  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
