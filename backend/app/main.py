from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.routes import router
from app.api.schemas import HealthResponse
from app.application.orchestrator import ConversationLockedError
from app.application.ports import ConversationNotFoundError
from app.config import get_settings
from app.container import get_container


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    container = get_container()
    try:
        yield
    finally:
        await container.aclose()
        get_container.cache_clear()


settings = get_settings()
app = FastAPI(
    title="ServeAI API",
    version="0.1.0",
    description="Orquestra descoberta, contato e reserva de serviços locais por chat.",
    lifespan=lifespan,
)

allowed_origins = list(settings.frontend_origins)
if settings.app_env != "production":
    allowed_origins.extend(["http://localhost:3000", "http://127.0.0.1:3000"])
app.add_middleware(
    CORSMiddleware,
    allow_origins=sorted(set(allowed_origins)),
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "Svix-Id", "Svix-Signature", "Svix-Timestamp"],
)

app.include_router(router, prefix=settings.api_prefix)


@app.exception_handler(ConversationNotFoundError)
async def conversation_not_found(_: Request, __: ConversationNotFoundError) -> JSONResponse:
    return JSONResponse(
        status_code=status.HTTP_404_NOT_FOUND,
        content={"detail": "Conversa não encontrada."},
    )


@app.exception_handler(ConversationLockedError)
async def conversation_locked(_: Request, exc: ConversationLockedError) -> JSONResponse:
    return JSONResponse(
        status_code=status.HTTP_409_CONFLICT,
        content={"detail": str(exc)},
    )


@app.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    container = get_container()
    return HealthResponse(
        service="ServeAI",
        environment=settings.app_env,
        repository=container.modes["repository"],
        llm=container.modes["llm"],
        discovery=container.modes["discovery"],
        contact=container.modes["contact"],
        calendar=container.modes["calendar"],
    )


@app.get("/", include_in_schema=False)
async def root() -> dict[str, str]:
    return {"service": "ServeAI", "docs": "/docs", "health": "/health"}
