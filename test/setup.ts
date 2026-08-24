// Point every test at a scratch database and a settlement backend that never
// touches the chain. Imported first by each test file, before anything reads
// the config.

process.env.MONGODB_URI ??= "mongodb://127.0.0.1:27019";
// Each test file runs in its own process and gets its own scratch database, so
// the files can run concurrently without wiping each other's fixtures.
const suite = (process.argv[1] ?? "suite").split("/").pop()!.replace(/\W+/g, "_");
process.env.MONGODB_DB = `wfit_gateway_test_${suite}`;
process.env.SESSION_SECRET ??= "test-session-secret-value-0123456789";
process.env.ADMIN_PASSWORD ??= "test-admin-password";
process.env.CARDANO_NETWORK ??= "preprod";
process.env.BACKGROUND_JOBS = "false";
process.env.SEPOLIA_DEPOSIT_ADDRESS ??= "0x0000000000000000000000000000000000000001";
process.env.CARDANO_DEPOSIT_ADDRESS ??= "addr_test1vpplaceholderdepositaddressfortestsonly000000000000000";
// Exercise the tUSDM settlement path in tests regardless of how the deployment
// is configured. It is a preprod test asset; nothing here touches real value.
process.env.SETTLEMENT_TUSDM_ENABLED ??= "true";
