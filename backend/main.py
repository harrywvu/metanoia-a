import logging
import boto3
import os
import subprocess
import tempfile
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from botocore.config import Config
from dotenv import load_dotenv

logging.basicConfig(level=logging.INFO)
load_dotenv()

from fastapi import BackgroundTasks, FastAPI, UploadFile, File, Form, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from db import (
    create_job,
    get_job,
    init_db,
    update_job_error,
    update_job_output_fbx_key,
    update_job_status,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


app = FastAPI(lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# R2 client setup
s3 = boto3.client(
    "s3",
    endpoint_url=f"https://{os.getenv('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com",
    aws_access_key_id=os.getenv("R2_ACCESS_KEY_ID"),
    aws_secret_access_key=os.getenv("R2_SECRET_ACCESS_KEY"),
    config=Config(signature_version="s3v4"),
    region_name="auto",
)

BUCKET = os.getenv("R2_BUCKET_NAME")


class ProcessRequest(BaseModel):
    r2_key: str


def fail_job(job_id: str, error: str) -> None:
    update_job_status(job_id, "failed")
    update_job_error(job_id, error)


def get_subprocess_error(result: subprocess.CompletedProcess[str]) -> str:
    return (result.stderr or result.stdout or "Subprocess failed").strip()


def process_job(job_id: str, r2_key: str) -> None:
    temp_dir = tempfile.mkdtemp()
    video_name = os.path.basename(r2_key)
    _, video_ext = os.path.splitext(video_name)
    video_stem = job_id
    temp_video_path = os.path.join(temp_dir, f"{job_id}.mp4")
    backend_dir = os.path.dirname(os.path.abspath(__file__))
    vibe_dir = os.path.normpath(os.path.join(backend_dir, "..", "VIBE"))
    blender_path = os.path.join(
        os.path.expanduser("~"),
        "blender-2.83.20-linux-x64",
        "blender",
    )
    fbx_script_path = os.path.join(vibe_dir, "lib", "utils", "fbx_output.py")
    gender = r2_key.split("/", 1)[0]

    try:
        if video_ext.lower() != ".mp4":
            raise ValueError(f"Expected an .mp4 input key, got: {r2_key}")

        try:
            s3.download_file(BUCKET, r2_key, temp_video_path)
        except Exception as exc:
            logging.error(f"R2 download failed for key {r2_key}: {exc}")
            raise
        logging.info(f"Video downloaded successfully to {temp_video_path}")

        update_job_status(job_id, "processing")

        vibe_output_dir = os.path.join(vibe_dir, "output", video_stem)
        vibe_result = subprocess.run(
            [
                "/home/harrywvu/.conda/envs/vibe-env/bin/python",
                "demo.py",
                "--vid_file",
                temp_video_path,
                "--output_folder",
                "output/",
                "--tracker_batch_size",
                "4",
                "--vibe_batch_size",
                "64",
            ],
            cwd=vibe_dir,
            capture_output=True,
            text=True,
        )
        if vibe_result.returncode != 0:
            logging.error(
                f"VIBE subprocess failed with exit code {vibe_result.returncode}: {vibe_result.stderr}"
            )
            fail_job(job_id, get_subprocess_error(vibe_result))
            return
        logging.info(f"VIBE completed successfully with output directory {vibe_output_dir}")

        blender_env = os.environ.copy()
        blender_env["LD_LIBRARY_PATH"] = (
            "/home/harrywvu/.conda/envs/vibe-env/lib/python3.7/site-packages/numpy.libs"
        )
        vibe_output_path = os.path.join(vibe_output_dir, "vibe_output.pkl")
        fbx_output_path = os.path.join(vibe_output_dir, "fbx_output.fbx")
        blender_result = subprocess.run(
            [
                blender_path,
                "--background",
                "--python",
                fbx_script_path,
                "--",
                "--input",
                vibe_output_path,
                "--output",
                fbx_output_path,
                "--fps_source",
                "30",
                "--fps_target",
                "30",
                "--gender",
                gender,
                "--person_id",
                "1",
            ],
            cwd=vibe_dir,
            env=blender_env,
            capture_output=True,
            text=True,
        )
        if blender_result.returncode != 0:
            logging.error(
                f"Blender subprocess failed with exit code {blender_result.returncode}: {blender_result.stderr}"
            )
            fail_job(job_id, get_subprocess_error(blender_result))
            return
        logging.info(f"Blender completed successfully with FBX path {fbx_output_path}")

        output_fbx_key = f"results/{job_id}/fbx_output.fbx"
        try:
            s3.upload_file(fbx_output_path, BUCKET, output_fbx_key)
        except Exception as exc:
            logging.error(f"R2 upload failed for local path {fbx_output_path}: {exc}")
            fail_job(job_id, str(exc))
            return

        update_job_output_fbx_key(job_id, output_fbx_key)
        update_job_status(job_id, "done")
        os.remove(temp_video_path)
    except Exception as exc:
        fail_job(job_id, str(exc))


@app.get("/")
async def root():
    return {"message": "Hello World"}


@app.post("/upload")
async def upload(video: UploadFile = File(...), gender: str = Form(...)):
    if not video:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No video found!")
    if not gender:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No gender found!")

    logging.info(f"Received: {video.filename}, {gender}")

    # Build a unique key so filenames don't collide
    ext = video.filename.rsplit(".", 1)[-1] if "." in video.filename else "mp4"
    key = f"{gender}/{uuid.uuid4()}.{ext}"

    try:
        s3.upload_fileobj(
            video.file,
            BUCKET,
            key,
            ExtraArgs={"ContentType": video.content_type or "video/mp4"},
        )
    except Exception as e:
        logging.error(f"Upload failed: {e}")
        raise HTTPException(status_code=500, detail="Upload to R2 failed")

    object_url = f"https://{os.getenv('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com/{BUCKET}/{key}"
    logging.info(f"Uploaded to: {object_url}")

    return {"ok": True, "key": key, "url": object_url}


@app.post("/process")
async def process(request: ProcessRequest, background_tasks: BackgroundTasks):
    job_id = str(uuid.uuid4())
    created_at = datetime.now(timezone.utc).isoformat()

    create_job(
        job_id=job_id,
        input_r2_key=request.r2_key,
        status="pending",
        created_at=created_at,
    )
    background_tasks.add_task(process_job, job_id, request.r2_key)

    return {"job_id": job_id}


@app.get("/job/{job_id}")
async def job_status(job_id: str):
    job = get_job(job_id)
    if job is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found")

    return job
