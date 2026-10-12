FROM karust/openserp:latest
USER root
# Upstream omits CA roots; HTTP search must validate remote certificates.
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
USER chrome
ENV OPENSERP_SERVER_HOST=:: OPENSERP_SERVER_PORT=7000 PORT=7000
EXPOSE 7000
CMD ["serve", "-a", "::", "-p", "7000", "--raw", "--insecure=false", "--timeout", "2"]
