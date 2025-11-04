require('dotenv').config();
require('./config/db'); // connect + index sync

const http = require('http');
const { Server } = require('socket.io');
const { PORT, HOST } = require('./config/constants');

const app = require('./app');
const { sessionMiddleware } = require('./session');

const server = http.createServer(app);
const io = new Server(server, {
  // you can put CORS here if needed
});
app.set('io', io);
app.use((req, _res, next) => { req.io = io; next(); });

io.engine.use(sessionMiddleware);
require('./sockets')(io);

require('./jobs/hardDelete').startHardDeleteJob();

server.listen(PORT, HOST, () => {
  console.log(`Server listening on http://${HOST}:${PORT}`);
});
