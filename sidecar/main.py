"""Parser sidecar stub. Module 0 only — returns health and 501 for parse."""

from fastapi import FastAPI
from fastapi.responses import JSONResponse

app = FastAPI(title="policyaction-sidecar", version="0.1.0")


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.post("/v1/parse")
async def parse():
    return JSONResponse(
        status_code=501,
        content={"error": "parse not implemented — sidecar stub only"},
    )
