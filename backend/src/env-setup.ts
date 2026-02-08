/**
 * Run immediately after dotenv so TLS and other env-dependent options
 * are set before any outbound HTTPS (OpenAI API, tracing export).
 * Set DISABLE_TLS_VERIFY=1 only in dev if you hit "UNABLE_TO_GET_ISSUER_CERT_LOCALLY".
 */
if (process.env.DISABLE_TLS_VERIFY === "1" || process.env.DISABLE_TLS_VERIFY === "true") {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  // Log so you can confirm in startup output (avoids "Connection error" from TLS cert issues)
  console.warn("[env-setup] NODE_TLS_REJECT_UNAUTHORIZED=0 (DISABLE_TLS_VERIFY is set; dev only)");
}
