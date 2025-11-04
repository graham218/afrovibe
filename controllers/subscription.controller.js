// controllers/subscription.controller.js
const mongoose = require('mongoose');
const User = require('../models/User');

const STRIPE_SECRET_KEY      = process.env.STRIPE_SECRET_KEY || '';
const STRIPE_PRICE_ID_PREMIUM= process.env.STRIPE_PRICE_ID_PREMIUM || process.env.STRIPE_PRICE_ID_SILVER || '';
const STRIPE_PRICE_ID_ELITE  = process.env.STRIPE_PRICE_ID_ELITE   || process.env.STRIPE_PRICE_ID_EMERALD || '';
const BASE_URL               = process.env.BASE_URL || '';

let stripe = null;
try {
  stripe = require('stripe')(STRIPE_SECRET_KEY);
} catch (_) {
  // keep null if not configured
}

// ---------- helpers ----------
const planOf = (u) => {
  const priceId = u?.stripePriceId || u?.subscriptionPriceId || null;
  if (priceId && String(priceId) === String(STRIPE_PRICE_ID_ELITE))   return 'elite';
  if (priceId && String(priceId) === String(STRIPE_PRICE_ID_PREMIUM)) return 'premium';
  if (u?.isPremium) return 'premium';
  return 'free';
};

const baseUrlFromReq = (req) => {
  const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0].trim();
  const host  = (req.headers['x-forwarded-host']  || req.get('host'));
  return `${proto}://${host}`;
};

const absoluteUrl = (req, path) =>
  (BASE_URL ? new URL(path, BASE_URL).href : new URL(path, baseUrlFromReq(req)).href);

const planFromPrice = (priceId) => {
  if (priceId && String(priceId) === String(STRIPE_PRICE_ID_ELITE))   return 'elite';
  if (priceId && String(priceId) === String(STRIPE_PRICE_ID_PREMIUM)) return 'premium';
  return 'free';
};

// ---------- controllers ----------
exports.upgradePage = async (req, res) => {
  try {
    const user = await User.findById(req.session.userId);
    if (!user) return res.status(404).send('User not found.');

    const plan    = planOf(user);
    const success = req.query.success || req.query.upgradeSuccess || null;
    const error   = req.query.error   || req.query.upgradeError   || null;

    return res.render('upgrade', { currentUser: user, plan, success, error });
  } catch (err) {
    console.error('upgrade page err', err);
    return res.status(500).send('Server Error');
  }
};

exports.checkoutPlan = async (req, res) => {
  try {
    if (!stripe) return res.status(500).send('Stripe not configured');

    const userId = req.session.userId;
    const user = await User.findById(userId).lean();
    if (!user) return res.status(404).send('User not found');

    const planParam = String(req.params.plan || '').toLowerCase(); // 'premium' | 'elite'
    const plan = (planParam === 'elite') ? 'elite' : 'premium';

    const priceId = plan === 'elite' ? STRIPE_PRICE_ID_ELITE : STRIPE_PRICE_ID_PREMIUM;
    if (!priceId) return res.status(400).send(`Price not configured for ${plan}`);

    const params = {
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: absoluteUrl(req, '/upgrade/success?session_id={CHECKOUT_SESSION_ID}'),
      cancel_url:  absoluteUrl(req, '/upgrade?upgradeError=cancelled'),
      client_reference_id: String(userId),
      metadata: { userId: String(userId), plan },
      allow_promotion_codes: true,
    };
    if (user.stripeCustomerId) params.customer = user.stripeCustomerId;

    console.log(`[stripe] create-checkout GET user=${userId} plan=${plan} price=${priceId}`);
    const session = await stripe.checkout.sessions.create(params);
    return res.redirect(303, session.url);
  } catch (err) {
    console.error('GET /checkout/:plan err', err);
    return res.status(500).send('Failed to create checkout session');
  }
};

exports.createCheckoutSession = async (req, res) => {
  try {
    if (!stripe) return res.status(500).send('Stripe not configured');

    const userId = req.session.userId;
    const user = await User.findById(userId).lean();
    if (!user) return res.status(404).send('User not found');

    const plan = String(req.body.plan || 'premium').toLowerCase();
    const priceId = plan === 'elite' ? STRIPE_PRICE_ID_ELITE : STRIPE_PRICE_ID_PREMIUM;
    if (!priceId) return res.status(400).send(`Price not configured for ${plan}`);

    const successUrl = absoluteUrl(req, '/upgrade/success?session_id={CHECKOUT_SESSION_ID}');
    const cancelUrl  = absoluteUrl(req, '/upgrade?upgradeError=cancelled');

    const params = {
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: successUrl,
      cancel_url:  cancelUrl,
      client_reference_id: String(userId),
      metadata: { userId: String(userId), plan },
      allow_promotion_codes: true,
    };
    if (user.stripeCustomerId) params.customer = user.stripeCustomerId;

    const session = await stripe.checkout.sessions.create(params);
    return res.redirect(303, session.url);
  } catch (err) {
    console.error('create-checkout-session err:', err);
    return res.status(500).send('Failed to create checkout session');
  }
};

exports.upgradeSuccess = async (req, res) => {
  try {
    const session_id = req.query.session_id;
    if (!session_id) return res.redirect('/upgrade?upgradeError=Missing session');

    const session = await stripe.checkout.sessions.retrieve(String(session_id), {
      expand: ['subscription.items.data.price']
    });
    if (!session || session.mode !== 'subscription') {
      return res.redirect('/upgrade?upgradeError=Invalid session');
    }

    const userId         = session.metadata?.userId || session.client_reference_id;
    const subscriptionId = typeof session.subscription === 'string'
      ? session.subscription
      : session.subscription?.id;
    const customerId     = typeof session.customer === 'string'
      ? session.customer
      : session.customer?.id;

    // Active price id from subscription
    let priceId = null;
    if (subscriptionId) {
      const sub = await stripe.subscriptions.retrieve(subscriptionId, { expand: ['items.data.price'] });
      priceId = sub.items?.data?.[0]?.price?.id || null;
    }

    if (userId) {
      await User.findByIdAndUpdate(userId, {
        $set: {
          stripeCustomerId: customerId || null,
          stripeSubscriptionId: subscriptionId || null,
          stripePriceId: priceId || null,
          subscriptionPriceId: priceId || null,
          isPremium: true,
          subscriptionStatus: 'active',
          subscriptionEndsAt: null
        }
      });
    }

    return res.redirect('/upgrade?upgradeSuccess=1');
  } catch (err) {
    console.error('upgrade success err:', err);
    return res.redirect('/upgrade?upgradeError=Could not finalize');
  }
};

exports.smartBillingEntry = async (req, res) => {
  const user = await User.findById(req.session.userId)
    .select('stripeCustomerId stripeSubscriptionId plan isPremium')
    .lean();
  if (!user) return res.redirect('/login');

  const hasSub =
    !!user.stripeSubscriptionId ||
    user.plan === 'silver' ||
    user.plan === 'emerald' ||
    user.isPremium;

  if (!hasSub) {
    return res.redirect(302, '/upgrade?from=billing');
  }
  return res.redirect(302, '/billing-portal');
};

exports.billingPortal = async (req, res) => {
  try {
    if (!stripe) return res.redirect('/upgrade?upgradeError=Stripe not configured');

    const user = await User.findById(req.session.userId).lean();
    if (!user) return res.redirect('/login');

    let customerId = user.stripeCustomerId;
    // Backfill customer from subscription if needed
    if (!customerId && user.stripeSubscriptionId) {
      try {
        const sub = await stripe.subscriptions.retrieve(user.stripeSubscriptionId);
        customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id || null;
        if (customerId) {
          await User.updateOne({ _id: user._id }, { $set: { stripeCustomerId: customerId } });
        }
      } catch (e) { /* soft-fail */ }
    }
    if (!customerId) return res.redirect('/upgrade?upgradeError=No Stripe customer on file. Complete checkout first.');

    // Light mode check to prevent live/test mismatch bugs
    const cust = await stripe.customers.retrieve(customerId);
    const keyMode  = STRIPE_SECRET_KEY.startsWith('sk_live_') ? 'live' : (STRIPE_SECRET_KEY.startsWith('sk_test_') ? 'test' : 'unknown');
    const custMode = cust.livemode ? 'live' : 'test';
    if (keyMode !== custMode) {
      return res.redirect(`/upgrade?upgradeError=Stripe key/data mode mismatch (${keyMode.toUpperCase()} vs ${custMode.toUpperCase()}).`);
    }

    const return_url = absoluteUrl(req, '/upgrade');
    const args = { customer: customerId, return_url };

    if (process.env.STRIPE_PORTAL_CONFIG_ID) {
      try {
        const cfg = await stripe.billingPortal.configurations.retrieve(process.env.STRIPE_PORTAL_CONFIG_ID);
        if (cfg?.id) args.configuration = cfg.id;
      } catch { /* ignore bad config id */ }
    }

    const session = await stripe.billingPortal.sessions.create(args);
    return res.redirect(303, session.url);
  } catch (err) {
    console.error('[billing-portal] error');
    return res.redirect('/upgrade?upgradeError=' + encodeURIComponent('Could not open billing portal.'));
  }
};

exports.cancelSubscription = async (req, res) => {
  try {
    if (!stripe) return res.status(500).json({ error: 'Stripe not configured' });
    const user = await User.findById(req.session.userId).lean();
    if (!user?.stripeSubscriptionId) return res.status(400).json({ error: 'No subscription' });

    const sub = await stripe.subscriptions.update(user.stripeSubscriptionId, { cancel_at_period_end: true });
    return res.json({ status: 'cancelling', endsAt: sub.current_period_end * 1000 });
  } catch (err) {
    console.error('cancel sub err:', err);
    return res.status(500).json({ error: 'Failed to cancel' });
  }
};

// ---------- Webhook ----------
exports.webhook = async (req, res) => {
  if (!stripe) return res.status(500).send('Stripe not configured');
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET || '';
  const sig = req.headers['stripe-signature'];

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
  } catch (err) {
    console.error('⚠️ Webhook signature verification failed.', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const userId        = session.metadata?.userId || session.client_reference_id || null;
        const subscriptionId = session.subscription;
        const customerId     = session.customer;

        let priceId = null;
        if (subscriptionId) {
          const sub = await stripe.subscriptions.retrieve(subscriptionId);
          priceId = sub.items?.data?.[0]?.price?.id || null;
        }
        if (userId) {
          const plan = planFromPrice(priceId) || session.metadata?.plan || 'premium';
          await User.findByIdAndUpdate(userId, {
            stripeCustomerId: customerId || null,
            stripeSubscriptionId: subscriptionId || null,
            stripePriceId: priceId || null,
            subscriptionPriceId: priceId || null,
            isPremium: plan !== 'free',
            subscriptionStatus: 'active',
            subscriptionEndsAt: null,
          });
        }
        break;
      }

      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const sub = event.data.object;
        const user = await User.findOne({ stripeSubscriptionId: sub.id });
        if (!user) break;

        const priceId = sub.items?.data?.[0]?.price?.id || user.subscriptionPriceId || null;
        const isActive = ['active', 'trialing', 'past_due'].includes(sub.status);
        const endsAt = (sub.cancel_at_period_end || sub.status === 'canceled')
          ? new Date(sub.current_period_end * 1000)
          : null;

        user.subscriptionStatus = sub.status;
        user.subscriptionEndsAt = endsAt;
        user.isPremium = isActive;
        user.stripePriceId = priceId;
        user.subscriptionPriceId = priceId;
        await user.save();
        break;
      }

      case 'invoice.payment_succeeded': {
        const subscriptionId = event.data.object.subscription;
        const user = await User.findOne({ stripeSubscriptionId: subscriptionId });
        if (user) {
          user.subscriptionStatus = 'active';
          user.subscriptionEndsAt = null;
          user.isPremium = true;
          await user.save();
        }
        break;
      }

      case 'invoice.payment_failed': {
        const subscriptionId = event.data.object.subscription;
        const user = await User.findOne({ stripeSubscriptionId: subscriptionId });
        if (user) {
          user.subscriptionStatus = 'past_due';
          await user.save();
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        const user = await User.findOne({ stripeSubscriptionId: sub.id });
        if (user) {
          user.subscriptionStatus = 'canceled';
          user.subscriptionEndsAt = new Date(sub.current_period_end * 1000);
          user.isPremium = false;
          await user.save();
        }
        break;
      }
      default: /* ignore others */ ;
    }

    return res.json({ received: true });
  } catch (err) {
    console.error('Webhook handling error', err);
    return res.status(500).end();
  }
};
