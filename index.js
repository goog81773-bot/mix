const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: "*" } });

app.use(express.static(path.join(__dirname, './')));
app.use(express.json());

// --- قواعد البيانات المؤقتة ---
const users = new Map();
const rooms = new Map();
const privateChats = new Map();
const purchaseRequests = [];
let requestIdCounter = 1;

rooms.set('general', { id: 'general', name: 'الساحة العامة', type: 'text', users: [], messages: [] });
rooms.set('voice1', { id: 'voice1', name: 'مجلس الأصوات', type: 'voice', users: [] });

// --- مسارات الملفات ---
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// --- نظام الاتصال والغرف ---
io.on('connection', (socket) => {
  console.log('اتصال جديد:', socket.id);
  let currentUser = null;

  // تسجيل الدخول
  socket.on('register-user', (data) => {
    currentUser = {
      id: socket.id,
      username: data.username,
      coins: 0,
      isAdmin: data.username === 'المالك' || data.username === 'الدعم'
    };
    users.set(socket.id, currentUser);
    socket.emit('login-success', { user: currentUser, rooms: Array.from(rooms.values()) });
    io.emit('users-count', users.size);
  });

  // الدخول لغرفة
  socket.on('join-room', (roomId) => {
    if(!rooms.has(roomId)) return;
    const room = rooms.get(roomId);
    socket.leaveAll();
    socket.join(roomId);
    if(!room.users.includes(socket.id)) room.users.push(socket.id);
    socket.emit('room-joined', room);
    io.to(roomId).emit('room-users-update', room.users.map(id => users.get(id)?.username));
  });

  // إنشاء غرفة جديدة
  socket.on('create-room', (roomData) => {
    const roomId = `room_${Date.now()}`;
    rooms.set(roomId, { id: roomId, ...roomData, users: [], messages: [] });
    io.emit('room-created', rooms.get(roomId));
  });

  // إرسال رسالة عامة
  socket.on('send-message', (data) => {
    const user = users.get(socket.id);
    if(!user) return;
    const msg = {
      id: Date.now(),
      user: user.username,
      text: data.text,
      time: new Date().toLocaleTimeString('ar-SA'),
      type: data.type || 'text'
    };
    rooms.get(data.roomId)?.messages.push(msg);
    io.to(data.roomId).emit('new-message', msg);
  });

  // رسائل خاصة
  socket.on('send-private', (data) => {
    const from = users.get(socket.id);
    const toSocket = Array.from(users.entries()).find(([_,u]) => u.username === data.toUser)?.[0];
    if(!from || !toSocket) return;
    
    const chatId = [from.username, data.toUser].sort().join('_');
    if(!privateChats.has(chatId)) privateChats.set(chatId, []);
    privateChats.get(chatId).push({ from: from.username, text: data.text, time: new Date().toLocaleTimeString('ar-SA') });
    
    io.to(toSocket).emit('private-message', { from: from.username, text: data.text });
    socket.emit('private-message', { from: 'أنت', to: data.toUser, text: data.text });
  });

  // نظام الورود والعملات
  socket.on('send-rose', (toUser) => {
    const user = users.get(socket.id);
    if(!user || user.coins < 5) return socket.emit('notify', 'لا يوجد لديك رصيد كافٍ من الورود 💎');
    user.coins -=5;
    const targetSocket = Array.from(users.entries()).find(([_,u]) => u.username === toUser)?.[0];
    if(targetSocket) {
      io.to(targetSocket).emit('rose-received', user.username);
      socket.emit('notify', 'تم إرسال وردة بنجاح 🌹');
    }
  });

  // طلب شراء
  socket.on('submit-purchase', (data) => {
    purchaseRequests.push({
      id: requestIdCounter++,
      name: data.name,
      contact: data.contact,
      item: data.item,
      status: 'بانتظار المراجعة'
    });
    socket.emit('notify', 'تم إرسال طلبك، سيتم التواصل معك قريباً ✅');
    io.emit('new-purchase-request', purchaseRequests.at(-1));
  });

  // موافقة المالك وفتح محادثة
  socket.on('approve-request', (reqId) => {
    const req = purchaseRequests.find(r => r.id === reqId);
    if(req) {
      req.status = 'تمت الموافقة';
      io.emit('request-approved', req);
    }
  });

  // قطع الاتصال
  socket.on('disconnect', () => {
    users.delete(socket.id);
    io.emit('users-count', users.size);
  });
});

server.listen(3000, () => console.log('✅ يعمل على المنفذ 3000'));
