// models/Ticket.js
const mongoose = require('mongoose');
const { Schema } = mongoose;

const TicketSchema = new Schema(
  {
    // "contact" | "report" | "help"
    type: { type: String, enum: ['contact', 'report', 'help'], required: true },

    // who is submitting
    reporter: { type: Schema.Types.ObjectId, ref: 'User' },   // optional (guest allowed)
    reporterEmail: { type: String, trim: true },              // fallback for guests
    reporterName:  { type: String, trim: true },

    // target (for reports)
    targetUser: { type: Schema.Types.ObjectId, ref: 'User' }, // optional
    targetUsername: { type: String, trim: true },             // helpful when ID unknown
    targetUrl: { type: String, trim: true },                  // e.g. /users/123

    // content
    subject: { type: String, trim: true, maxlength: 200 },
    category: { type: String, trim: true, maxlength: 80 },    // e.g., "Safety", "Payments"
    message:  { type: String, trim: true, maxlength: 4000, required: true },

    // ops
    status: { type: String, enum: ['open', 'closed'], default: 'open' },
    meta:   { type: Schema.Types.Mixed }, // anything extra you want to stash (UA, ip, etc.)
  },
  { timestamps: true }
);

TicketSchema.index({ type: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model('Ticket', TicketSchema);
