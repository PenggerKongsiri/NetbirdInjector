FROM node:24.18.0-bookworm-slim

RUN groupadd --system --gid 10001 nim && useradd --system --uid 10001 --gid nim --home-dir /var/lib/netbird-injector-manager --shell /usr/sbin/nologin nim
WORKDIR /app
COPY --chown=root:root package.json package-lock.json LICENSE ./
COPY --chown=root:root src ./src
RUN mkdir -p /var/lib/netbird-injector-manager && chown -R nim:nim /var/lib/netbird-injector-manager && chmod -R go-w /app
USER 10001:10001
ENV NIM_CONFIG=/etc/netbird-injector-manager/config.json
EXPOSE 8080
VOLUME ["/var/lib/netbird-injector-manager"]
HEALTHCHECK --interval=30s --timeout=3s --retries=3 CMD ["node", "-e", "fetch('http://127.0.0.1:9090/healthz',{signal:AbortSignal.timeout(2000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "src/main.mjs"]
