const mongoose = require('mongoose');
const dns = require('dns');

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error('MONGODB_URI is missing. Set it in .env');
  process.exit(1);
}

try { dns.setDefaultResultOrder('ipv4first'); } catch {}

mongoose.connect(MONGODB_URI, {
  maxPoolSize: 10,
  minPoolSize: 1,
  serverSelectionTimeoutMS: 15000,
  socketTimeoutMS: 45000,
  connectTimeoutMS: 15000,
  autoIndex: process.env.NODE_ENV !== 'production',
  family: 4
})
.then(() => console.log('MongoDB connected'))
.catch(err => console.error('MongoDB connection error:', err));

mongoose.connection.once('open', async () => {
  try {
    // Lazy require models only after connect
    const User         = require('../models/User');
    const Message      = require('../models/Message');
    const Notification = require('../models/Notification');

    const inProd = process.env.NODE_ENV === 'production';
    const opName = inProd ? 'createIndexes' : 'syncIndexes';

    await User[opName]();         console.log(`[indexes] User ${opName} done`);
    await Message[opName]();      console.log(`[indexes] Message ${opName} done`);
    await Notification[opName](); console.log(`[indexes] Notification ${opName} done`);
  } catch (e) {
    console.error('indexes init error', e);
  }
});

mongoose.connection.on('error', err => console.error('Mongo error:', err?.message || err));
mongoose.connection.on('disconnected', () => console.warn('Mongo disconnected'));

module.exports = mongoose;
