import logging
logging.basicConfig(level=logging.INFO)
from fastapi import FastAPI, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # simplify for dev
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
async def root():
    return {"message": "Hello World"}

@app.post("/upload")
async def upload(video: UploadFile = File(...), gender: str = Form(...)):
    logging.info(f"Received: {video.filename}, {gender}")
    return {"ok": True}