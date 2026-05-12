# Metanoia Technical Overview

## Purpose
Metanoia is a creator-facing workflow that turns short human-motion videos into reusable 3D animation. The codebase combines a lightweight web client, a FastAPI backend, and the VIBE research stack for pose/shape inference plus Blender-based export.

## Top-Level Layout
- **backend/**: FastAPI service for upload, processing, job tracking, and notifications.
- **client/**: Static web UI (HTML/CSS/JS) for uploads, status, and 3D preview.
- **VIBE/**: Research codebase for Video Inference for Body Pose and Shape Estimation (CVPR 2020) plus dataset utilities, training, and export tools.
- **start-up-run.txt**: Local run checklist for VIBE inference and Blender export.
- **what-it-is.md**: High-level product explanation.

## System Architecture
### 1) Web Client (client/)
- **Stack**: Static HTML/CSS/JS, no build step.
- **Key behaviors**:
  - Validates uploads (size, format, and duration).
  - Submits video + gender to the backend.
  - Polls job status and updates a progress stepper.
  - Loads the resulting glTF in a Three.js viewer and provides download links for FBX or glTF.
- **Notable integrations**:
  - Three.js + `GLTFLoader` for interactive playback.
  - Lottie animations for marketing/UX sections.

### 2) Backend Service (backend/)
- **Stack**: FastAPI + SQLite + Cloudflare R2 (S3-compatible) + Discord webhook.
- **Endpoints**:
  - `POST /upload`: uploads raw video to R2 and returns the object key.
  - `POST /process`: creates a job and runs the processing pipeline in a background task.
  - `GET /job/{job_id}`: returns job status and output keys.
- **Job storage**:
  - SQLite database at backend/jobs.db.
  - Tracks job status, input key, output keys (FBX + glTF), and error messages.
- **Processing pipeline**:
  1. Download the uploaded video from R2.
  2. Run VIBE inference to produce `vibe_output.pkl`.
  3. Run Blender in background with `lib/utils/fbx_output.py` to export FBX and glTF.
  4. Upload outputs back to R2.
  5. Update job record and optionally send a Discord notification.

### 3) VIBE Engine (VIBE/)
- **Purpose**: VIBE predicts SMPL body pose/shape for each frame in a video.
- **Key areas**:
  - **demo.py**: entry point used by the backend to run inference.
  - **lib/models/**: VIBE, SPIN, SMPL models.
  - **lib/utils/**: exporters and rendering utilities (includes FBX/glTF export script).
  - **lib/dataset/** and **lib/data_utils/**: dataset preparation and loaders.
  - **configs/**: training and inference configuration.
- **Outputs**:
  - `output/<job_id>/vibe_output.pkl`: SMPL parameters + meshes.
  - FBX/glTF exports from the Blender conversion step.

## Data Flow (End-to-End)
1. User selects a short video and gender in the client.
2. Client sends the video to `POST /upload` → backend stores in R2 and returns a key.
3. Client calls `POST /process` with the R2 key → backend creates a job and starts processing.
4. Backend downloads the video, runs VIBE inference, converts outputs to FBX and glTF, uploads results.
5. Client polls `GET /job/{job_id}` until status is `done` and then loads the glTF in the viewer.

## Runtime Dependencies
- **Python** (backend and VIBE).
- **Conda environment** for VIBE (per start-up-run.txt).
- **Blender** (headless) for FBX/glTF conversion.
- **Cloudflare R2** for input/output storage.
- **Discord webhook** (optional) for completion notifications.

## Configuration & Environment
Backend expects these environment variables:
- `R2_ACCOUNT_ID`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_BUCKET_NAME`
- `DISCORD_WEBHOOK_URL` (optional)

The client currently targets local backend URLs on port 8001 and a public R2 base URL for results.

## Operational Notes
- The inference pipeline is compute-heavy and depends on the VIBE model weights and SMPL assets.
- Blender runs in background mode with a custom export script to generate both FBX and glTF.
- The VIBE codebase includes training, evaluation, and dataset preparation scripts that are not required for the production pipeline but are needed for research workflows.

## Testing
- **VIBE/tests/** contains dataset-related tests for the research stack.

## License & Attribution
- The VIBE folder is a third-party research codebase with its own license and dataset requirements. See VIBE/LICENSE and upstream documentation for usage restrictions.
