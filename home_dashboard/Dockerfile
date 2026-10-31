ARG BUILD_FROM
FROM $BUILD_FROM

# Alpine 3.21 ships Node.js 22. The app has no npm dependencies.
RUN apk add --no-cache nodejs

WORKDIR /app
COPY app/ /app/
RUN rm -rf /app/test /app/dev

CMD ["node", "/app/server.mjs"]
