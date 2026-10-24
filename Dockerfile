# syntax=docker/dockerfile:1
# The package is not published yet and the sample depends on the sister folder ../BancontactPro.TypeScript, so the build context
# is the folder that holds both repositories. From this folder: docker compose up --build (see docker-compose.yml).

FROM node:24-alpine AS build
WORKDIR /work

# The library: build it to dist/, which is what the sample imports.
COPY BancontactPro.TypeScript/package.json BancontactPro.TypeScript/package-lock.json BancontactPro.TypeScript/
RUN npm --prefix BancontactPro.TypeScript ci
COPY BancontactPro.TypeScript/ BancontactPro.TypeScript/
RUN npm --prefix BancontactPro.TypeScript run build

# The sample: its file: dependency links to ../BancontactPro.TypeScript, so keep the same layout.
COPY BancontactPro.SDK.Samples.TypeScript/package.json BancontactPro.SDK.Samples.TypeScript/package-lock.json BancontactPro.SDK.Samples.TypeScript/
RUN npm --prefix BancontactPro.SDK.Samples.TypeScript ci --omit=dev
COPY BancontactPro.SDK.Samples.TypeScript/src/ BancontactPro.SDK.Samples.TypeScript/src/
COPY BancontactPro.SDK.Samples.TypeScript/public/ BancontactPro.SDK.Samples.TypeScript/public/

FROM node:24-alpine
WORKDIR /work/BancontactPro.SDK.Samples.TypeScript
COPY --from=build /work/BancontactPro.TypeScript/package.json /work/BancontactPro.TypeScript/package.json
COPY --from=build /work/BancontactPro.TypeScript/dist /work/BancontactPro.TypeScript/dist
COPY --from=build /work/BancontactPro.SDK.Samples.TypeScript .

USER node
ENV HOST=0.0.0.0 PORT=8080
EXPOSE 8080
CMD ["node", "src/server.ts"]
