FROM denoland/deno AS builder
COPY ./ /app
WORKDIR /app
RUN deno task build

FROM gcr.io/distroless/cc AS runner
ENV DENO_TLS_CA_STORE=mozilla,system
COPY --from=builder /app/dist/main /
ENTRYPOINT [ "/main" ]