module.exports = {
  apps: [
    {
      name: "wfit-stablecoin-gateway",
      cwd: __dirname,
      script: "dist/server.cjs",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_memory_restart: "400M",
      env: { NODE_ENV: "production" },
      out_file: "logs/out.log",
      error_file: "logs/error.log",
      time: true,
    },
  ],
};
