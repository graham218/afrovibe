const multer = require('multer');
const path = require('path');

const storage = multer.diskStorage({
  destination: (req,file,cb)=> cb(null, path.join(process.cwd(),'uploads/photos')),
  filename: (req,file,cb)=> cb(null, Date.now() + '-' + Math.round(Math.random()*1e9) + path.extname(file.originalname))
});

const ALLOWED = new Set(['image/jpeg','image/png','image/webp']);
const upload = multer({
  storage,
  limits: { fileSize: 2_000_000 },
  fileFilter: (req,file,cb)=>{
    if (!ALLOWED.has(file.mimetype)) return cb(new Error('Only JPG/PNG/WEBP allowed'));
    cb(null,true);
  }
});

module.exports = { upload };
