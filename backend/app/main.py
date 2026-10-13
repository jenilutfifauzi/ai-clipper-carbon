from fastapi import FastAPI

app = FastAPI(title="AI Clipper")


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
