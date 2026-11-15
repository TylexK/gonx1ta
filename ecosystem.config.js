module.exports = {
  apps: [
    {
      name: 'gonxta-bot',
      script: './server.js',
      cwd: __dirname,
      autorestart: true,
      restart_delay: 5000,
      min_uptime: '30s',
      max_restarts: 10,
      kill_timeout: 10000,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        PORT: Number(process.env.PORT || 3000),
        PANEL_HOST: process.env.PANEL_HOST || '127.0.0.1',
        DB_STORAGE: 'sqlite',
      }
    }
  ]
};
