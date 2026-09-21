// Keep local production-like .env values from changing HTTP test semantics.
// Individual suites still provide their own isolated data paths and secrets.
process.env.NODE_ENV = 'test';
process.env.AUTH_COOKIE_SECURE = 'false';
process.env.AUTH_COOKIE_NAME ||= 'veldr_test_auth';
