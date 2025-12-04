# Badge Check - Production Deployment Checklist

## 🚀 Ready to Launch

Your Badge Check application is ready to be published as a live website. Follow this guide to ensure a smooth deployment.

## ✅ Pre-Deployment Checklist

### Required Environment Variables (Already Configured ✓)
- ✅ `OPENAI_API_KEY` - AI badge analysis (configured)
- ✅ `STRIPE_SECRET_KEY` - Payment processing (configured)
- ✅ `SESSION_SECRET` - Session security (configured)
- ✅ `DATABASE_URL` - PostgreSQL database (configured)

### Critical: Production-Only Environment Variables

#### 🔒 STRIPE_WEBHOOK_SECRET (REQUIRED for Production)
**Status:** ⚠️ NOT YET CONFIGURED

**Why it's critical:** 
- Protects against fraudulent webhook events
- Ensures payment confirmations are genuine
- Required for purchase confirmation emails to send

**How to set it up:**
1. Go to your Stripe Dashboard: https://dashboard.stripe.com/webhooks
2. Create a new webhook endpoint with URL: `https://your-domain.com/api/webhooks/stripe`
3. Select event: `checkout.session.completed`
4. Copy the "Signing secret" (starts with `whsec_`)
5. In Railway environment variables, add:
   - Key: `STRIPE_WEBHOOK_SECRET`
   - Value: `whsec_...` (your signing secret)

**⚠️ WARNING:** Without this secret:
- Payments will still work, but webhooks will be rejected
- Users won't receive purchase confirmation emails
- Complaint/lawsuit records won't be marked as paid automatically

#### 📧 RESEND_API_KEY (Optional but Recommended)
**Status:** ⚠️ NOT YET CONFIGURED

**Why you want it:**
- Sends welcome emails to new users
- Sends purchase confirmation emails with document copies
- Professional email experience for users

**How to set it up:**
1. Sign up at https://resend.com (free tier available)
2. Create an API key
3. In Railway environment variables, add:
   - Key: `RESEND_API_KEY`
   - Value: Your API key from Resend

**Email functionality is fully coded and ready** - just add the API key!

## 🌐 Deployment Steps

### 1. Configure Production Secrets (Before Publishing)
Add the required secrets listed above in Railway's environment variables.

### 2. Test Your Application
Before going live, test these critical flows:
- ✅ User login/signup
- ✅ Badge photo upload and analysis
- ✅ Complaint form submission and payment
- ✅ Lawsuit form submission and payment
- ✅ Evidence file uploads
- ✅ Document preview functionality

### 3. Configure Stripe Webhook (After Publishing)
**Important:** You need your live deployment URL first!

Once you publish your app:
1. Note your deployment URL (e.g., `https://badgecheck.repl.co` or your custom domain)
2. In Stripe Dashboard → Webhooks, add endpoint:
   - URL: `https://YOUR-DOMAIN/api/webhooks/stripe`
   - Event: `checkout.session.completed`
3. Copy the signing secret to `STRIPE_WEBHOOK_SECRET` in Railway environment variables

### 4. Deploy Your App
1. Deploy through Railway dashboard or CLI
2. Choose **"Autoscale Deployment"** (recommended for web apps)
3. Configure:
   - Machine: Select based on expected traffic (start small, can scale up)
   - Max instances: Start with 2-3, adjust based on usage
4. Click **"Publish"** and wait for deployment

### 5. Post-Deployment Verification
After publishing, test:
- [ ] Homepage loads and login works
- [ ] All authenticated pages require login
- [ ] Payment flow completes successfully
- [ ] Webhook handler receives events (check Stripe Dashboard logs)
- [ ] Emails send correctly (if RESEND_API_KEY configured)

## 💰 Pricing Model

The app operates on a **pay-per-use model**:
- **Complaint Filing:** $29.99 per submission
- **Lawsuit Filing:** $29.99 per filing

No subscriptions, no recurring charges - users only pay when they submit.

## 🔐 Security Features

Your app includes:
- ✅ Authentication via Replit OAuth
- ✅ Login required for all main features
- ✅ Session-based security with PostgreSQL storage
- ✅ Stripe payment processing with webhook signature verification
- ✅ Evidence file access control (owner-only access)
- ✅ Privacy-first design (no personal names on payment pages)

## 📊 Monitoring After Launch

Keep an eye on:
1. **Stripe Dashboard** - Monitor payments and webhook deliveries
2. **Database usage** - Watch for growth patterns
3. **Application logs** - Check for errors or issues
4. **User feedback** - Monitor for bug reports or feature requests

## 🆘 Troubleshooting

### Webhooks Not Working
- Check `STRIPE_WEBHOOK_SECRET` is set correctly
- Verify webhook URL in Stripe Dashboard matches your deployment URL
- Check Stripe webhook logs for delivery failures

### Emails Not Sending
- Verify `RESEND_API_KEY` is set
- Check Resend dashboard for delivery logs
- Verify REPLIT_DOMAINS environment variable is set

### Payment Issues
- Check Stripe Dashboard for payment status
- Verify `STRIPE_SECRET_KEY` is correct
- Check application logs for errors

## 📝 Next Steps After Launch

Consider these enhancements:
1. Set up custom domain (optional)
2. Monitor user analytics
3. Gather user feedback
4. Plan feature improvements based on usage patterns

## ✅ You're Ready!

Your Badge Check app is production-ready. Once you've configured the webhook secret, you can publish with confidence!

---

**Questions?** Review the Replit deployment documentation or reach out for support.
