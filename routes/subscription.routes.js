// routes/subscription.routes.js
const express = require('express');
const checkAuth = require('../middleware/checkAuth');
const ctrl = require('../controllers/subscription.controller');

const router = express.Router();

// Webhook MUST use raw body. Mounting it here is fine as long as this
// router is used BEFORE express.json() in app.js, OR we pass the raw
// parser inline (we do below).
router.post('/webhook', express.raw({ type: 'application/json' }), ctrl.webhook);

// Upgrade landing + success
router.get('/upgrade', checkAuth, ctrl.upgradePage);
router.get('/upgrade/success', checkAuth, ctrl.upgradeSuccess);

// Checkout (either GET route with :plan, or POST form)
router.get('/checkout/:plan', checkAuth, ctrl.checkoutPlan);
router.post('/create-checkout-session', checkAuth, ctrl.createCheckoutSession);

// Smart billing entry (decide whether to show upgrade or jump to portal)
router.get('/billing', checkAuth, ctrl.smartBillingEntry);
router.get('/settings/billing', checkAuth, ctrl.smartBillingEntry);

// Stripe Billing Portal (support both POST form and GET link)
router.post('/billing-portal', checkAuth, ctrl.billingPortal);
router.get('/billing-portal',  checkAuth, ctrl.billingPortal);

// Cancel subscription (period end)
router.post('/subscription/cancel', checkAuth, ctrl.cancelSubscription);

module.exports = router;

