import logging
import boto3
import os
import time
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

from db import create_job, get_job, init_db, update_job_status


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


def process_job(job_id: str) -> None:
    update_job_status(job_id, "processing")
    time.sleep(5)
    update_job_status(job_id, "done")


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
    background_tasks.add_task(process_job, job_id)

    return {"job_id": job_id}


@app.get("/job/{job_id}")
async def job_status(job_id: str):
    job = get_job(job_id)
    if job is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found")

    return job
