@echo off
setlocal enabledelayedexpansion
REM ============================================================================
REM Apex Sports Coaching Platform -- Google Cloud Run deployment
REM ----------------------------------------------------------------------------
REM This is a SPLIT monorepo, so it deploys TWO Cloud Run services (not one
REM combined container):
REM   1. scp-server  Express + Mongoose API   (server/Dockerfile)    -> $PORT
REM   2. scp-web     Next.js App Router front  (apps/web/Dockerfile)  -> $PORT
REM
REM Ordering matters: the web bundle inlines the API URL at BUILD time
REM (NEXT_PUBLIC_* is baked into the client bundle), so we must:
REM     deploy API  ->  read its URL  ->  build+deploy web with that URL
REM     ->  point the API's CORS_ORIGIN at the deployed web URL.
REM
REM Server secrets (MONGODB_URI, JWT_ACCESS_SECRET, JWT_REFRESH_SECRET, ...)
REM are read from env.server.yaml. Copy env.server.yaml.example first and fill
REM it in. Both containers read Cloud Run's injected PORT automatically.
REM ============================================================================

set PROJECT_ID=legel-assistent-466812
set REPOSITORY_NAME=bizzzup
set REGION=asia-south1
set IMAGE_TAG=v16

set SERVER_IMAGE=scp-server
set SERVER_SERVICE=scp-server
set WEB_IMAGE=scp-web
set WEB_SERVICE=scp-web

REM Google Sign-In client ID (public; baked into the web bundle + verified by the
REM API). Must match GOOGLE_CLIENT_ID in env.server.yaml. Empty = feature off.
set GOOGLE_CLIENT_ID=895210689446-ogejtfnpokvmh6kstejcj6oeag0cfl9o.apps.googleusercontent.com

set REGISTRY=%REGION%-docker.pkg.dev/%PROJECT_ID%/%REPOSITORY_NAME%

REM ---- Preflight -------------------------------------------------------------
if not exist env.server.yaml (
  echo [ERROR] env.server.yaml not found.
  echo         Copy env.server.yaml.example to env.server.yaml and fill in
  echo         MONGODB_URI + strong, unique JWT secrets before deploying.
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
REM 2/3) Web frontend -- build (API URL baked in), push, deploy
REM ===========================================================================
echo.
echo === [2/3] Building web image (NEXT_PUBLIC_API_BASE_URL=%SERVER_URL%) ===
docker build --no-cache -f apps/web/Dockerfile ^
  --build-arg NEXT_PUBLIC_API_BASE_URL=%SERVER_URL% ^
  --build-arg NEXT_PUBLIC_GOOGLE_CLIENT_ID=%GOOGLE_CLIENT_ID% ^
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
endlocal
