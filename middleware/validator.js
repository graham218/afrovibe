// middleware/validator.js
const { body, param, validationResult } = require('express-validator');

function validate(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ ok: false, errors: errors.array() });
  }
  next();
}

const validateObjectId = (name = 'id') =>
  param(name).isMongoId().withMessage(`${name} must be a MongoId`);

const vSetLocation = [
  body('lat').isFloat({ min: -90, max: 90 }).withMessage('Invalid latitude'),
  body('lng').isFloat({ min: -180, max: 180 }).withMessage('Invalid longitude'),
  validate,
];

module.exports = { validate, validateObjectId, vSetLocation };
