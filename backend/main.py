import logging
import boto3
import os
import uuid
from botocore.config import Config
from dotenv import load_dotenv

logging.basicConfig(level=logging.INFO)
load_dotenv()

from fastapi import FastAPI, UploadFile, File, Form, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()
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