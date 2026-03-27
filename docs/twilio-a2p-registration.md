# Twilio A2P 10DLC Registration Guide

## Problem

SMS messages are being blocked by carriers with **error 30034** ("Message blocked by messaging
filter"). This happens because our Twilio numbers are not registered for A2P (Application-to-Person)
10DLC messaging. Since June 2023, all US carriers require A2P 10DLC registration for business
SMS traffic on 10-digit long codes.

## Current Account Status (as of 2026-03-27)

| Item | Status | SID |
|------|--------|-----|
| Twilio Account | Active | $TWILIO_ACCOUNT_SID |
| Basic TrustHub Profile | Twilio-Approved | BU14d7f62587c87fec1a004cbe12f09a45 |
| Primary Customer Profile (A2P) | **NOT CREATED** | -- |
| A2P Brand Registration | **FAILED** (wrong profile type) | BNd083df6880338859e9cd51aa360cd281 |
| Messaging Service | **NOT CREATED** | -- |
| A2P Campaign | **NOT CREATED** | -- |

**Phone numbers on account:**
- +15139573283 (TWILIO_FROM_NUMBER)
- +15138484821 (TWILIO_PHONE_NUMBER / BACKUP_1)
- +15136435916 (BACKUP_2)
- +15137964979 (BACKUP_3)

## Why the First Brand Registration Failed

The existing TrustHub profile (`BU14d7f62587c87fec1a004cbe12f09a45`) uses regulation
`RNffcb02a20420c81caf596ffc44f69712` (basic e-KYC profile). A2P 10DLC brand registration
requires either:
- **Primary Customer Profile** (regulation `RN6433641899984f951173ef1738c3bdd0`)
- **Secondary Customer Profile** (regulation `RNdfbf3fae0e1107f8aded0e7cead80bf5`)

## Registration Type Decision

Since **9 Enterprises LLC** is a registered LLC (Ohio SOS Doc: 202608403826), we must register as
either a **Standard Brand** or **Low-Volume Standard Brand** -- NOT as a Sole Proprietor.

**Recommended: Low-Volume Standard Brand**
- Best for < 6,000 message segments/day (we are well under this)
- One-time registration fee: **$4.50** (vs $46 for Standard)
- No secondary vetting required (vs included/required for Standard)
- Monthly campaign fee: **$2.00** for LOW_VOLUME use case
- Campaign vetting fee: **$15.00** one-time

**If we needed higher throughput later:** Standard Brand ($46 one-time, includes secondary vetting,
higher MPS throughput based on trust score).

## BLOCKER: EIN Required

The Primary Customer Profile requires the business EIN (Employer Identification Number) for
9 Enterprises LLC. This was **not found** in `.env` or any project files.

**Jasson must provide the EIN before registration can proceed.**

Once provided, add to `.env`:
```
NINE_ENTERPRISES_EIN=XX-XXXXXXX
```

## Step-by-Step Registration Process

### Step 1: Create Primary Customer Profile (API)

This requires three entities:
1. **Business Information** (EndUser type: `customer_profile_business_information`)
2. **Authorized Representative** (EndUser type: `authorized_representative_1`)
3. **Physical Address Document** (already exists: `ADafaadd06090a0105118909f1ab1099ad`)

#### 1a. Create Business Information EndUser

```bash
curl -X POST "https://trusthub.twilio.com/v1/EndUsers" \
  -u "$TWILIO_ACCOUNT_SID:$TWILIO_AUTH_TOKEN" \
  -d "FriendlyName=9 Enterprises LLC" \
  -d "Type=customer_profile_business_information" \
  -d 'Attributes={"business_type":"LLC","business_registration_number":"<EIN_HERE>","business_name":"9 Enterprises LLC","business_registration_identifier":"EIN","business_identity":"direct_customer","business_industry":"TECHNOLOGY","website_url":"https://ainflgm.com","business_regions_of_operation":"USA_AND_CANADA","social_media_profile_urls":"https://x.com/x9ai"}'
```

#### 1b. Create Authorized Representative EndUser

```bash
curl -X POST "https://trusthub.twilio.com/v1/EndUsers" \
  -u "$TWILIO_ACCOUNT_SID:$TWILIO_AUTH_TOKEN" \
  -d "FriendlyName=Jasson Fishback - Auth Rep" \
  -d "Type=authorized_representative_1" \
  -d 'Attributes={"first_name":"Jasson","last_name":"Fishback","email":"emailfishback@gmail.com","phone_number":"+15134031829","business_title":"Owner","job_position":"CEO"}'
```

#### 1c. Create Address Supporting Document

We already have an address (`ADafaadd06090a0105118909f1ab1099ad`), but need a supporting doc referencing it:

```bash
curl -X POST "https://trusthub.twilio.com/v1/SupportingDocuments" \
  -u "$TWILIO_ACCOUNT_SID:$TWILIO_AUTH_TOKEN" \
  -d "FriendlyName=9 Enterprises Business Address" \
  -d "Type=customer_profile_address" \
  -d 'Attributes={"address_sids":"ADafaadd06090a0105118909f1ab1099ad"}'
```

#### 1d. Create the Primary Customer Profile Bundle

```bash
curl -X POST "https://trusthub.twilio.com/v1/CustomerProfiles" \
  -u "$TWILIO_ACCOUNT_SID:$TWILIO_AUTH_TOKEN" \
  -d "FriendlyName=9 Enterprises LLC - A2P Primary Profile" \
  -d "Email=emailfishback@gmail.com" \
  -d "PolicySid=RN6433641899984f951173ef1738c3bdd0"
```

Save the returned `sid` (starts with `BU`).

#### 1e. Assign All Entities to the Profile

```bash
# Assign business info
curl -X POST "https://trusthub.twilio.com/v1/CustomerProfiles/<PROFILE_SID>/EntityAssignments" \
  -u "$TWILIO_ACCOUNT_SID:$TWILIO_AUTH_TOKEN" \
  -d "ObjectSid=<BUSINESS_INFO_SID>"

# Assign authorized representative
curl -X POST "https://trusthub.twilio.com/v1/CustomerProfiles/<PROFILE_SID>/EntityAssignments" \
  -u "$TWILIO_ACCOUNT_SID:$TWILIO_AUTH_TOKEN" \
  -d "ObjectSid=<AUTH_REP_SID>"

# Assign address document
curl -X POST "https://trusthub.twilio.com/v1/CustomerProfiles/<PROFILE_SID>/EntityAssignments" \
  -u "$TWILIO_ACCOUNT_SID:$TWILIO_AUTH_TOKEN" \
  -d "ObjectSid=<ADDRESS_DOC_SID>"
```

#### 1f. Submit Profile for Review

```bash
curl -X POST "https://trusthub.twilio.com/v1/CustomerProfiles/<PROFILE_SID>/Evaluations" \
  -u "$TWILIO_ACCOUNT_SID:$TWILIO_AUTH_TOKEN" \
  -d "PolicySid=RN6433641899984f951173ef1738c3bdd0"
```

Then update status to `pending-review`:
```bash
curl -X POST "https://trusthub.twilio.com/v1/CustomerProfiles/<PROFILE_SID>" \
  -u "$TWILIO_ACCOUNT_SID:$TWILIO_AUTH_TOKEN" \
  -d "Status=pending-review"
```

**Timeline:** Up to 72 hours for Twilio approval, but you can proceed to Step 2 while pending.

### Step 2: Register A2P Brand

```bash
curl -X POST "https://messaging.twilio.com/v1/a2p/BrandRegistrations" \
  -u "$TWILIO_ACCOUNT_SID:$TWILIO_AUTH_TOKEN" \
  -d "CustomerProfileBundleSid=<PRIMARY_PROFILE_SID>" \
  -d "A2PProfileBundleSid=<PRIMARY_PROFILE_SID>" \
  -d "BrandType=STANDARD"
```

Note: Even for Low-Volume Standard, the `BrandType` is `STANDARD`. The low-volume distinction
happens at the Campaign level.

**Timeline:** Usually a few minutes for TCR review, but can vary.

### Step 3: Create a Messaging Service

```bash
curl -X POST "https://messaging.twilio.com/v1/Services" \
  -u "$TWILIO_ACCOUNT_SID:$TWILIO_AUTH_TOKEN" \
  -d "FriendlyName=9 Enterprises SMS" \
  -d "UseInboundWebhookOnNumber=true"
```

Save the returned `sid` (starts with `MG`).

Then add phone numbers to the service:
```bash
# Add each number
curl -X POST "https://messaging.twilio.com/v1/Services/<SERVICE_SID>/PhoneNumbers" \
  -u "$TWILIO_ACCOUNT_SID:$TWILIO_AUTH_TOKEN" \
  -d "PhoneNumberSid=PN932fd32e2f16a0ac2e38b92b6fc29469"

# Repeat for other numbers:
# PN60e34fe823e229eb268588acdc46328b
# PN7ed6e130eeb6ea17631cd668ad7a032a
# PNc4dbc85e3fa691748394b16ff619360e
```

### Step 4: Register A2P Campaign

```bash
curl -X POST "https://messaging.twilio.com/v1/Services/<SERVICE_SID>/UsAppToPerson" \
  -u "$TWILIO_ACCOUNT_SID:$TWILIO_AUTH_TOKEN" \
  -d "BrandRegistrationSid=<BRAND_SID>" \
  -d "Description=9 Enterprises sends notifications, alerts, and customer care messages related to the AiNFL GM fantasy football platform and internal business communications." \
  -d "MessageFlow=Users opt in to receive SMS by providing their phone number through our website or by texting START to our number. Users can opt out at any time by texting STOP." \
  -d "MessageSamples=[\"Your AiNFL GM draft results are ready. Check your team at ainflgm.com\",\"Trade alert: You have a new trade offer pending review.\"]" \
  -d "UsAppToPersonUsecase=LOW_VOLUME" \
  -d "HasEmbeddedLinks=true" \
  -d "HasEmbeddedPhone=false" \
  -d "OptInType=VERBAL"
```

**Campaign use case recommendation:** `LOW_VOLUME` -- covers multiple use cases (notifications,
customer care, alerts) at the lowest monthly fee ($2/month) and lowest throughput tier.

If we ever need dedicated higher throughput, we could register a `MIXED` campaign ($10/month)
or specific use-case campaigns like `CUSTOMER_CARE` ($10/month).

**Timeline:** Campaign reviews currently take **10-15 business days** due to high volume of submissions.

### Step 5: Verify Campaign Approval

```bash
curl -s -u "$TWILIO_ACCOUNT_SID:$TWILIO_AUTH_TOKEN" \
  "https://messaging.twilio.com/v1/Services/<SERVICE_SID>/UsAppToPerson" \
  | python3 -m json.tool
```

Look for `"campaign_status": "VERIFIED"`.

### Step 6: Update Code to Use Messaging Service

After campaign approval, update SMS sending code to use the Messaging Service SID instead of
a direct phone number as the `From` parameter:

```javascript
// Before (blocked by carriers):
from: process.env.TWILIO_FROM_NUMBER

// After (A2P compliant):
messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID
```

## Fee Summary

| Fee | Amount | Frequency |
|-----|--------|-----------|
| Low-Volume Standard Brand Registration | $4.50 | One-time |
| Campaign Vetting | $15.00 | One-time |
| LOW_VOLUME Campaign | $2.00 | Monthly |
| **Total to start** | **$21.50** | |
| **Ongoing** | **$2.00/month** | |

Per-message carrier surcharges also apply (typically $0.003-$0.005 per message segment).

## Alternative: Console Registration (Easier)

All of the above can also be done through the Twilio Console UI:

1. Go to **Messaging > Regulatory Compliance > Bundles** and create a new Primary Customer Profile
2. Go to **Messaging > Trust Center > A2P 10DLC** and register the brand
3. Go to **Messaging > Services** and create a Messaging Service
4. Go to **Messaging > Trust Center > A2P 10DLC > Campaigns** and register the campaign

The Console provides a guided wizard that is more forgiving of errors. The API approach above
is fully documented for automation.

**Console URL:** https://console.twilio.com/us1/develop/sms/regulatory-compliance/bundles

## Action Items

1. **[BLOCKER] Get EIN for 9 Enterprises LLC** -- Jasson must provide this
2. Add EIN to `.env` as `NINE_ENTERPRISES_EIN`
3. Run Step 1 (Create Primary Customer Profile) -- can be done via API or Console
4. Run Step 2 (Register Brand) -- wait for profile approval or proceed while pending
5. Run Step 3 (Create Messaging Service)
6. Run Step 4 (Register Campaign)
7. Wait 10-15 business days for campaign approval
8. Run Step 6 (Update code to use Messaging Service SID)
9. Test SMS delivery

## References

- [Twilio A2P 10DLC Overview](https://www.twilio.com/docs/messaging/compliance/a2p-10dlc)
- [Direct Standard Registration Guide](https://www.twilio.com/docs/messaging/compliance/a2p-10dlc/direct-standard-onboarding)
- [Brand Registration API](https://www.twilio.com/docs/messaging/api/brand-registration-resource)
- [A2P 10DLC Pricing](https://support.twilio.com/hc/en-us/articles/1260803965530-What-pricing-and-fees-are-associated-with-the-A2P-10DLC-service)
- [Campaign Use Case Types](https://support.twilio.com/hc/en-us/articles/1260801844470-List-of-campaign-use-case-types-for-A2P-10DLC-registration)
- [Campaign Approval Requirements](https://help.twilio.com/articles/11847054539547-A2P-10DLC-Campaign-Approval-Requirements)
- [Low-Volume Standard Brand Info](https://www.twilio.com/en-us/changelog/us-a2p-10dlc-low-volume-standard-brand-registration-available-in-twilio-console)
