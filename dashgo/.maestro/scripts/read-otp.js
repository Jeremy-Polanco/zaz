// Maestro script: read the dev-mode OTP for MAESTRO_PHONE from the api
// container's stdout. Mirrors the e2e/helpers.ts behaviour on web.
//
// Sets `output.otp` for the calling flow to inject into the code field.

const phone = MAESTRO_PHONE || '';
if (!phone) {
  throw new Error('read-otp.js: MAESTRO_PHONE env var is required');
}

// Maestro JS scripts run in a sandboxed engine. `exec` is the way to shell
// out — wraps the host command and returns { stdout, stderr, code }.
const cmd =
  'docker logs --tail 300 dashgo-api 2>&1 | grep -F "' +
  phone +
  '" | grep -oE "código DashGo es [0-9]+" | tail -1 | grep -oE "[0-9]+"';

const result = exec({ command: cmd });
const code = (result.stdout || '').trim();
if (!/^\d{6}$/.test(code)) {
  throw new Error(
    'read-otp.js: failed to parse OTP for ' + phone + ' from api logs. Got: "' + code + '"',
  );
}
output.otp = code;
