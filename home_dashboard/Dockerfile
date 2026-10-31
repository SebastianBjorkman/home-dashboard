ARG BUILD_FROM
FROM $BUILD_FROM

# Alpine 3.21 ships Node.js 22. The app has no npm dependencies.
RUN apk add --no-cache nodejs

WORKDIR /app
COPY app/ /app/
RUN rm -rf /app/test /app/dev

# Run Node directly instead of under the base image's s6 init: s6 resets the
# environment, which would drop SUPERVISOR_TOKEN and TZ.
ENTRYPOINT ["node", "/app/server.mjs"]
