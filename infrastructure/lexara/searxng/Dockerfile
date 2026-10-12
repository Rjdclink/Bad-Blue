FROM docker.io/searxng/searxng:latest
COPY settings.yml /etc/searxng/settings.yml
# Generate the instance signing secret inside the image, never in repository code.
RUN instance_secret="$(od -An -N32 -tx1 /dev/urandom | tr -d ' \n')" && sed -i "s/GENERATED_AT_BUILD/$instance_secret/" /etc/searxng/settings.yml
ENV SEARXNG_SETTINGS_PATH=/etc/searxng/settings.yml GRANIAN_HOST=:: GRANIAN_PORT=8080 PORT=8080
EXPOSE 8080
