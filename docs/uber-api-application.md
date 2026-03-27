# Uber Consumer Delivery API — Application Guide

## Intake Form URL

**Apply here:** https://developer.uber.com/

Sign in or create a developer account, then navigate to **Dashboard > Create App** to register a new application. The Uber Eats / Direct delivery API requires approval through the Uber Developer Platform.

For the **Uber Direct (Delivery as a Service)** API specifically:
- Portal: https://developer.uber.com/docs/deliveries/introduction
- Sign-up: https://www.uber.com/us/en/business/uber-direct/

## What They Need

### Account Information
- **Business name:** 9 Enterprises LLC (or whichever entity)
- **Contact email:** x9agent@proton.me (or primary business email)
- **Website URL:** ainflgm.com or a dedicated landing page
- **Business type:** Technology / Software

### Application Details
- **App name:** (e.g., "9 Food Delivery Integration")
- **App description:** Describe the use case — AI-powered food ordering and delivery coordination
- **Requested API scopes:**
  - `eats.deliveries` — Create and manage deliveries
  - `eats.store` — Store/restaurant catalog access (if needed)
  - `eats.orders` — Order management

### Technical Requirements
- **OAuth 2.0 callback URL:** Your server endpoint (e.g., `https://yourdomain.com/auth/uber/callback`)
- **Webhook URL:** Endpoint to receive delivery status updates
- **Server-to-server auth:** Client credentials flow (no user login needed for Direct API)

### Business Verification (for production access)
- Business registration / EIN
- Proof of business address
- Description of delivery volume expectations
- Use case explanation

## Two API Options

### Option A: Uber Direct (Recommended)
- **What it is:** White-label delivery — you request a driver, Uber handles logistics
- **Best for:** Ordering food from any restaurant and having it delivered
- **No Uber Eats branding** required in your app
- **Pricing:** Per-delivery fee (varies by distance/market)
- **Sign up:** https://www.uber.com/us/en/business/uber-direct/

### Option B: Uber Eats API (Marketplace)
- **What it is:** Full Uber Eats integration — browse restaurants, place orders
- **Requires:** Uber Eats partner agreement
- **More restrictive** approval process
- **Better for:** Building a full food ordering experience

## Application Steps

1. Go to https://developer.uber.com/ and create a developer account
2. Create a new app in the dashboard
3. Select the scopes you need (Deliveries for Uber Direct)
4. Fill in the business details and callback URLs
5. Submit for review — approval typically takes 3-5 business days
6. Once approved, you get:
   - **Client ID**
   - **Client Secret**
   - Access to the sandbox environment for testing

## Sandbox Testing

Uber provides a sandbox environment at `https://sandbox-api.uber.com/` where you can:
- Simulate delivery creation
- Test webhook events
- Verify your integration before going live

## Environment Variables Needed

| Variable | Description |
|----------|-------------|
| `UBER_CLIENT_ID` | OAuth Client ID from developer dashboard |
| `UBER_CLIENT_SECRET` | OAuth Client Secret |
| `UBER_CUSTOMER_ID` | Your Uber Direct customer ID (after approval) |

## Existing POC

See `scripts/food-order-poc.mjs` for the existing proof-of-concept code.
