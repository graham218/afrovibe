// sockets/index.js
const { Types: { ObjectId } } = require('mongoose');
const User = require('../models/User');
const Message = require('../models/Message');

module.exports = function initSockets(io) {
  // simple per-socket rate limit
  const MESSAGE_LIMIT_WINDOW_MS = 15_000; // 15s
  const MESSAGE_LIMIT_COUNT = 8;

  // gate: must have session + userId (session shared in server.js)
  io.use((socket, next) => {
    const sess = socket.request?.session;
    if (!sess?.userId) return next(new Error('unauthorized'));
    socket.userId = String(sess.userId);
    next();
  });

  function canVideoChat(user) {
    const hasToggle = !!(user?.videoChat || user?.profile?.videoChat);
    const isPaid =
      String(user?.subscriptionPriceId || '').toLowerCase().includes('elite') ||
      String(user?.stripePriceId || '').toLowerCase().includes('elite') ||
      !!user?.isPremium;
    return hasToggle || isPaid;
  }

  // one-time RTC gate
  io.use(async (socket, next) => {
    try {
      const uid = socket.request?.session?.userId;
      if (!uid) return next(new Error('unauthorized'));

      const user = await User.findById(uid)
        .select('isPremium stripePriceId subscriptionPriceId videoChat profile.videoChat')
        .lean();

      if (!user) return next(new Error('unauthorized'));

      socket.user         = user;
      socket.userId       = String(uid);
      socket.canVideoChat = !!(canVideoChat(user) || user?.profile?.videoChat === true);

      console.log(`[rtc] gate uid=${socket.userId} canVideo=${socket.canVideoChat}`);
      next();
    } catch (e) { next(e); }
  });

  // connection handler
  io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id} (uid=${socket.userId})`);

    socket.join(socket.userId);
    socket.data.userId = socket.userId;
    socket.data.msgCount = 0;
    socket.data.msgWindowStart = Date.now();

    const isValidId = (id) => typeof id === 'string' && ObjectId.isValid(id);

    const checkRateLimit = () => {
      const now = Date.now();
      if (now - socket.data.msgWindowStart > MESSAGE_LIMIT_WINDOW_MS) {
        socket.data.msgWindowStart = now;
        socket.data.msgCount = 0;
      }
      socket.data.msgCount += 1;
      return socket.data.msgCount <= MESSAGE_LIMIT_COUNT;
    };

    async function emitUnreadUpdate(userId) {
      try {
        if (!ObjectId.isValid(userId)) return;
        const me = new ObjectId(userId);
        const unread = await Message.countDocuments({
          recipient: me, read: false, deletedFor: { $nin: [me] },
        });
        io.to(userId).emit('unread_update', { unread });
      } catch (e) { console.error('unread emit err', e); }
    }

    socket.on('register_for_notifications', (userId) => {
      try {
        const uid = String(userId || '');
        if (!isValidId(uid)) return;
        socket.join(uid);
        console.log(`User ${uid} registered on ${socket.id}`);
      } catch (e) { console.error('register_for_notifications error', e); }
    });

    socket.on('chat:typing', (payload = {}) => {
      try {
        const to = String(payload.to || '');
        if (!isValidId(to)) return;
        io.to(to).emit('chat:typing', { from: socket.userId });
      } catch (e) { console.error('typing err', e); }
    });

    // optional realtime send (HTTP POST remains the source of truth)
    socket.on('chat_message', async (data, ack) => {
      if (process.env.ENABLE_SOCKET_SEND !== '1') {
        return typeof ack === 'function' && ack({ ok: false, error: 'disabled' });
      }
      try {
        if (!checkRateLimit()) {
          return typeof ack === 'function' && ack({ ok: false, error: 'rate_limited' });
        }
        const sender    = String(data?.sender || '');
        const recipient = String(data?.recipient || '');
        let content     = (typeof data?.content === 'string' ? data.content : '').trim();
        if (!isValidId(sender) || !isValidId(recipient) || !content) {
          return typeof ack === 'function' && ack({ ok: false, error: 'invalid' });
        }
        if (content.length > 4000) content = content.slice(0, 4000);

        const msg = await Message.create({ sender, recipient, content, read: false });
        io.to(recipient).emit('new_message', msg);
        io.to(sender).emit('new_message', msg);
        await emitUnreadUpdate(recipient);

        return typeof ack === 'function' && ack({ ok: true, item: msg });
      } catch (err) {
        console.error('chat_message err', err);
        return typeof ack === 'function' && ack({ ok: false, error: 'server_error' });
      }
    });

    // ---- RTC helpers & events ----
    function guardRTC(handler) {
      return (payload = {}) => {
        if (!socket.canVideoChat) {
          socket.emit('rtc:error', { code: 'upgrade-required', message: 'Upgrade required for video chat.' });
          return;
        }
        handler(payload);
      };
    }
    const getFrom = () => String(socket.data.userId || '');

    socket.on('rtc:call', guardRTC(({ to, meta }) => {
      const from = getFrom(); if (!to || !from) return;
      io.to(String(to)).emit('rtc:ring', { from, meta: meta || {} });
    }));

    socket.on('rtc:offer', guardRTC(({ to, sdp }) => {
      const from = getFrom(); if (!to || !from || !sdp) return;
      io.to(String(to)).emit('rtc:offer', { from, sdp });
    }));

    socket.on('rtc:answer', guardRTC(({ to, sdp }) => {
      const from = getFrom(); if (!to || !from || !sdp) return;
      io.to(String(to)).emit('rtc:answer', { from, sdp });
    }));

    socket.on('rtc:candidate', guardRTC(({ to, candidate }) => {
      const from = getFrom(); if (!to || !from || !candidate) return;
      io.to(String(to)).emit('rtc:candidate', { from, candidate });
    }));

    socket.on('rtc:end', guardRTC(({ to, reason }) => {
      const from = getFrom(); if (!to || !from) return;
      io.to(String(to)).emit('rtc:end', { from, reason: reason || 'hangup' });
    }));

    // legacy aliases
    socket.on('rtc:hangup', guardRTC(({ to }) => {
      const from = getFrom(); if (!to || !from) return;
      io.to(String(to)).emit('rtc:end', { from, reason: 'hangup' });
    }));
    socket.on('rtc:decline', guardRTC(({ to }) => {
      const from = getFrom(); if (!to || !from) return;
      io.to(String(to)).emit('rtc:end', { from, reason: 'declined' });
    }));

    socket.on('disconnect', () => {
      // optional cleanup
    });
  });
};
