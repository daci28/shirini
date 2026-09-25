module.exports = {
  apps: [
    {
      name: 'shirini',
      script: 'dist/server.cjs',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: process.env.PORT || 3000
      },
      restart_delay: 4000,
      max_memory_restart: '400M'
    }
  ]
};
