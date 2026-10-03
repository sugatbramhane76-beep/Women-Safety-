# SafeHer: automatic emergency SMS

This project contains:
- `index.html`: your SafeHer page with a cleaned-up JavaScript implementation.
- `server.js`: Express backend that sends SMS using Twilio.
- `package.json`: backend dependencies.
- `.env.example`: environment-variable template.

## Important safety and deployment notes

1. Automatic SMS will not work until the backend is deployed and the SMS provider account is configured.
2. Do not put Twilio credentials in `index.html`, GitHub Pages, or any public repository.
3. Configure `ALLOWED_ORIGINS` to your exact GitHub Pages origin.
4. The sample endpoint uses an IP rate limit (3 requests/hour) and accepts at most five recipients. CORS is not authentication and does not stop all abuse. Before real-world use, add user authentication and server-side verified/registered contacts, abuse monitoring, and a tested emergency-service workflow.
5. Test only with your own phone numbers and with contacts who have agreed to receive test messages. Avoid sending repeated test alerts.
6. A successful API response means the SMS provider accepted the request; it does not guarantee delivery to the recipient. Check provider message status.
7. Twilio trial accounts may only send to verified recipient numbers, and SMS availability/pricing vary by country and account configuration.
8. Browser geolocation generally requires HTTPS and permission. Mobile browsers may suspend monitoring while the page is backgrounded. This web app is not a replacement for calling local emergency services.

## Run the backend locally

Install Node.js 20 or later, then in this folder:

```bash
npm install
```

Set the environment variables from `.env.example` in your terminal or hosting dashboard. Do not upload a real `.env` file to GitHub. For local development you can use a local-only environment loader, but keep credentials private.

Windows PowerShell example (replace values with your own credentials):
```powershell
$env:TWILIO_ACCOUNT_SID="AC..."
$env:TWILIO_AUTH_TOKEN="..."
$env:TWILIO_PHONE_NUMBER="+1..."
$env:ALLOWED_ORIGINS="https://sugatbramhane76-beep.github.io"
npm start
```

Check `http://localhost:3000/health`. To test from the hosted website, deploy the backend to a public HTTPS host and replace `AUTO_SMS_ENDPOINT` near the top of the JavaScript in `index.html` with:
`https://YOUR-DEPLOYED-BACKEND/api/emergency-alert`

Then publish the updated `index.html` to the GitHub Pages repository.

## Backend hosting

Deploy this folder as a Node.js web service on a hosting provider that supports Node.js. Set the variables in the provider's secret/environment settings:
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_PHONE_NUMBER`
- `ALLOWED_ORIGINS`

Use the provider's HTTPS URL in `AUTO_SMS_ENDPOINT`. Keep the backend alive on a reliable host; a sleeping/free service may delay emergency alerts.

## SMS message flow

After the SOS countdown, the page requests GPS, posts the message and saved contacts to the backend, and the backend calls the SMS provider for each unique valid contact. Failed sends are reported in the status box. The SMS provider may accept a request before final carrier delivery is known.
