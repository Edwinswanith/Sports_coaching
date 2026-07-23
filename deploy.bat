@echo off
setlocal enabledelayedexpansion
REM ============================================================================
REM Apex Sports Coaching Platform -- Google Cloud Run deployment
REM ----------------------------------------------------------------------------
REM This is a SPLIT monorepo, so it deploys TWO Cloud Run services (not one
REM combined container):
REM   1. scp-server  Express + Mongoose API              (server/Dockerfile) -> $PORT
REM   2. scp-web     Expo Router app exported as a static (mobile/Dockerfile)
REM                  web (React Native Web) SPA, served by `serve`             -> $PORT
REM
REM scp-web deploys the MOBILE app's web export (mobile), served by `serve`
REM on Cloud Run. The mobile app authenticates with a Bearer token in
REM SecureStore, which falls back to plain localStorage on web (an Expo
REM limitation) — the access token is JS-readable on this deployment.
REM Accepted tradeoff; revisit if this becomes a real security concern.
REM
REM Ordering matters: the web bundle inlines the API URL at BUILD time
REM (EXPO_PUBLIC_* is baked into the client bundle), so we must:
REM     deploy API  ->  read its URL  ->  build+deploy web with that URL
REM     ->  point the API's CORS_ORIGIN at the deployed web URL.
REM
REM Server secrets (MONGODB_URI, JWT_*, GEMINI_API_KEY, GOOGLE_CLIENT_ID, ...)
REM are read from env.server.yaml. Copy env.server.yaml.example first and fill
REM it in. The web service is a static SPA with no server-side secrets, so it
REM has no env-vars-file (the mobile SPA has no server-side secrets).
REM Both containers read Cloud Run's injected PORT automatically.
REM ============================================================================

set PROJECT_ID=legel-assistent-466812
set REPOSITORY_NAME=sports-coaching-platform
set REGION=asia-south1
set IMAGE_TAG=v19

set SERVER_IMAGE=scp-server
set SERVER_SERVICE=scp-server
set WEB_IMAGE=scp-web
set WEB_SERVICE=scp-web

REM Google Sign-In client ID (public; baked into the web bundle + verified by the
REM API). Must match GOOGLE_CLIENT_ID in env.server.yaml. Empty = feature off.
set GOOGLE_CLIENT_ID=895210689446-ogejtfnpokvmh6kstejcj6oeag0cfl9o.apps.googleusercontent.com
REM Must match the OAuth client's Authorized JavaScript origins in Google Cloud.
REM Include both Cloud Run URL forms used by the deployed mobile-web frontend.
set GOOGLE_ALLOWED_ORIGINS=https://scp-web-futtj2vwgq-el.a.run.app,https://scp-web-895210689446.asia-south1.run.app

REM Guided tour trigger — a RUNTIME Cloud Run env var (not a build-arg), read
REM at container startup by docker/entrypoint.sh. Editable later straight from
REM the Cloud Run console (Edit & deploy new revision -> env var) with NO image
REM rebuild needed. false = shows once per new user. true = replays every login.
set TOUR_ALWAYS_SHOW=false

set REGISTRY=%REGION%-docker.pkg.dev/%PROJECT_ID%/%REPOSITORY_NAME%

REM ---- Preflight -------------------------------------------------------------
if not exist env.server.yaml (
  echo [ERROR] env.server.yaml not found.
  echo         Copy env.server.yaml.example to env.server.yaml and fill in
  echo         MONGODB_URI + strong, unique JWT secrets before deploying.
  echo         Optional: GEMINI_API_KEY powers workout-image conversion, voice
  echo         intent NLU, and guided tour narration on the API server.
  exit /b 1
)

echo Authenticating with Google Cloud...
call gcloud auth configure-docker %REGION%-docker.pkg.dev --quiet
if errorlevel 1 exit /b %errorlevel%
call gcloud config set project %PROJECT_ID%
if errorlevel 1 exit /b %errorlevel%

REM Create the Artifact Registry repo once (uncomment on first run):
REM call gcloud artifacts repositories create %REPOSITORY_NAME% --repository-format=docker --location=%REGION%

REM ===========================================================================
REM 1/3) API server -- build, push, deploy
REM ===========================================================================
echo.
echo === [1/3] Building API server image ===
docker build --no-cache -f server/Dockerfile -t %REGISTRY%/%SERVER_IMAGE%:%IMAGE_TAG% .
if errorlevel 1 exit /b %errorlevel%

echo Pushing API server image...
docker push %REGISTRY%/%SERVER_IMAGE%:%IMAGE_TAG%
if errorlevel 1 exit /b %errorlevel%

echo Deploying API server to Cloud Run...
call gcloud run deploy %SERVER_SERVICE% ^
  --image %REGISTRY%/%SERVER_IMAGE%:%IMAGE_TAG% ^
  --platform managed ^
  --region %REGION% ^
  --allow-unauthenticated ^
  --port=8080 ^
  --timeout=60s ^
  --min-instances=0 ^
  --max-instances=10 ^
  --memory=512Mi ^
  --cpu=1 ^
  --cpu-boost ^
  --env-vars-file=env.server.yaml
if errorlevel 1 exit /b %errorlevel%

REM Read the server's public URL (needed to build the web bundle).
set SERVER_URL=
for /f "delims=" %%u in ('gcloud run services describe %SERVER_SERVICE% --region %REGION% --format="value(status.url)"') do set SERVER_URL=%%u
if "%SERVER_URL%"=="" (
  echo [ERROR] Could not read API server URL.
  exit /b 1
)
echo API server URL: %SERVER_URL%

REM ===========================================================================
REM 2/3) Web frontend -- build mobile's web export (API URL baked in), push, deploy
REM ===========================================================================
echo.
echo === [2/3] Building mobile-web image (EXPO_PUBLIC_API_BASE_URL=%SERVER_URL%) ===
docker build --no-cache -f mobile/Dockerfile ^
  --build-arg EXPO_PUBLIC_API_BASE_URL=%SERVER_URL% ^
  --build-arg EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=%GOOGLE_CLIENT_ID% ^
  --build-arg EXPO_PUBLIC_GOOGLE_ALLOWED_ORIGINS=%GOOGLE_ALLOWED_ORIGINS% ^
  -t %REGISTRY%/%WEB_IMAGE%:%IMAGE_TAG% .
if errorlevel 1 exit /b %errorlevel%

echo Pushing web image...
docker push %REGISTRY%/%WEB_IMAGE%:%IMAGE_TAG%
if errorlevel 1 exit /b %errorlevel%

echo Deploying web to Cloud Run...
call gcloud run deploy %WEB_SERVICE% ^
  --image %REGISTRY%/%WEB_IMAGE%:%IMAGE_TAG% ^
  --platform managed ^
  --region %REGION% ^
  --allow-unauthenticated ^
  --port=8080 ^
  --timeout=60s ^
  --set-env-vars TOUR_ALWAYS_SHOW=%TOUR_ALWAYS_SHOW% ^
  --min-instances=0 ^
  --max-instances=10 ^
  --memory=512Mi ^
  --cpu=1 ^
  --cpu-boost
if errorlevel 1 exit /b %errorlevel%

set WEB_URL=
for /f "delims=" %%u in ('gcloud run services describe %WEB_SERVICE% --region %REGION% --format="value(status.url)"') do set WEB_URL=%%u
if "%WEB_URL%"=="" (
  echo [ERROR] Could not read web URL.
  exit /b 1
)
echo Web URL: %WEB_URL%

REM ===========================================================================
REM 3/3) Point the API's CORS at the deployed web origin
REM ===========================================================================
echo.
echo === [3/3] Updating API CORS_ORIGIN -^> %WEB_URL% ===
call gcloud run services update %SERVER_SERVICE% ^
  --region %REGION% ^
  --update-env-vars CORS_ORIGIN=%WEB_URL%
if errorlevel 1 exit /b %errorlevel%

echo.
echo ============================================================
echo Deployment complete!
echo   Web : %WEB_URL%
echo   API : %SERVER_URL%
echo ============================================================
echo.
echo Reminder: allow Cloud Run egress in MongoDB Atlas (Network Access
echo allow-list) or the API cannot reach the database.
echo.
echo AI keys:
echo   API  GEMINI_API_KEY in env.server.yaml  - workout OCR, voice NLU, tour
endlocal
