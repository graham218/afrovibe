const fs = require('fs');
const path = require('path');
const multer = require('multer');

const uploadDir = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext  = path.extname(file.originalname || '').toLowerCase();
    const base = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    cb(null, base + ext);
  }
});

const upload = multer({ storage });

module.exports = { uploadDir, upload };
