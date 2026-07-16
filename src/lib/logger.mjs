const levels = { debug: 10, info: 20, warn: 30, error: 40 };

export function createLogger(level = 'info', sink = process.stdout) {
  const threshold = levels[level] ?? levels.info;
  const write = (name, event, fields = {}) => {
    if (levels[name] < threshold) return;
    const safe = {};
    for (const [key, value] of Object.entries(fields)) {
      if (/authorization|cookie|token|password|body|content|secret/i.test(key)) continue;
      safe[key] = value instanceof Error ? value.message : value;
    }
    sink.write(`${JSON.stringify({ time: new Date().toISOString(), level: name, event, ...safe })}\n`);
  };
  return {
    debug: (event, fields) => write('debug', event, fields),
    info: (event, fields) => write('info', event, fields),
    warn: (event, fields) => write('warn', event, fields),
    error: (event, fields) => write('error', event, fields),
  };
}
