FROM karust/openserp:latest
USER root
# Upstream omits CA roots; HTTP search must validate remote certificates.
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
USER chrome
EXPOSE 7000
CMD ["serve", "-a", "0.0.0.0", "-p", "7000", "--raw", "--insecure=false", "--timeout", "2"]
